// Execute the real TypeScript Edge handlers with synthetic Auth/database clients.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const actor = '00000000-0000-0000-0000-000000000001';
const target = '00000000-0000-0000-0000-000000000002';
const created = '00000000-0000-0000-0000-000000000003';
const team = '00000000-0000-0000-0000-000000000004';
const invite = 'ABCDEF0123456789ABCDEF0123456789';
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message); checks++; };

function fixture(name, mode = {}) {
  let handler;
  const calls = [];
  const admin = {
    auth: {
      getUser: async token => { calls.push(['verify', token]); return token === 'forged' ? { error: new Error('Invalid JWT'), data: {} } : { data: { user: { id: actor } } }; },
      admin: {
        createUser: async input => { calls.push(['create', input]); return mode.createError ? { error: new Error('Already registered'), data: {} } : { data: { user: { id: created } } }; },
        deleteUser: async id => { calls.push(['delete', id]); return { error: mode.deleteError ? new Error('Synthetic Auth failure') : null }; },
      },
    },
    from: table => ({ upsert: async value => { calls.push(['profile', table, value]); return { error: mode.profileError ? new Error('Synthetic profile failure') : null }; } }),
    rpc: async (name, args) => { calls.push(['admin-rpc', name, args]); return mode.initError ? { error: new Error('Invalid invitation') } : { data: { approval_status: 'pending', status: 'registered' } }; },
  };
  const user = {
    rpc: async (name, args) => {
      calls.push(['user-rpc', name, args]);
      if (name === 'get_my_team_access') return { data: { approval_status: mode.approval || 'approved', team: { id: team } }, error: mode.accessError ? new Error('No access') : null };
      if (name === 'can_coach_delete_account') return { data: mode.permitted !== false, error: null };
      if (name === 'prepare_coach_account_deletion') return { data: { ready: mode.prepared !== false }, error: mode.preparationError ? new Error('Revoked') : null };
      throw new Error(`Unexpected user RPC ${name}`);
    },
    from: table => {
      const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => { calls.push(['target-read', table]); return { data: mode.missingTarget ? null : { id: target, display_name: 'Synthetic rider', role: mode.targetRole || 'athlete' } }; } };
      return query;
    },
  };
  const source = fs.readFileSync(path.join(root, 'supabase/functions', name, 'index.ts'), 'utf8').replace(/^import .*;\s*/m, '');
  const context = { Request, Response, Set, console: { error() {} },
    createClient: (_url, key, options) => { calls.push(['client', key]); return options?.global ? user : admin; },
    Deno: { env: { get: key => ({ SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' }[key]) }, serve: callback => { handler = callback; } },
  };
  vm.runInNewContext(stripTypeScriptTypes(source), context);
  return { calls, invoke: async (body, token = 'anon', origin = 'https://jkcoachingau.github.io') => {
    const result = await handler(new Request('https://synthetic/functions/v1/test', { method: 'POST', headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: result.status, body: await result.json() };
  } };
}

(async () => {
  const base = { email: 'synthetic@example.com', password: 'synthetic-password-123', displayName: 'Synthetic Coach', role: 'coach', countryCode: 'DE', countryName: 'Germany', teamRole: 'head_coach', teamName: 'Synthetic Team' };
  for (const patch of [{ countryCode: '' }, { countryCode: 'GERMANY' }, { teamRole: 'admin' }, { teamName: '' }, { teamRole: 'assistant_coach', inviteCode: '' }]) {
    const f = fixture('create-jkcrew-account'); const response = await f.invoke({ ...base, ...patch });
    eq(Boolean(response.body.error), true, 'Invalid role/country/team/invite is rejected');
    eq(f.calls.filter(call => call[0] === 'create').length, 0, 'Validation never creates an Auth user');
  }
  for (const role of ['head_coach', 'coach', 'assistant_coach']) {
    const f = fixture('create-jkcrew-account'); const result = await f.invoke({ ...base, teamRole: role, inviteCode: role === 'head_coach' ? '' : invite });
    eq(result.status, 201, 'A valid coach registration completes');
    eq(result.body.approvalStatus, 'pending', 'Every coach registration awaits platform approval');
    const creation = f.calls.find(call => call[0] === 'create')[1];
    eq(creation.app_metadata, { role: 'coach' }, 'A team role never becomes an Auth admin/owner role');
    eq(f.calls.find(call => call[0] === 'admin-rpc').slice(1), ['initialize_registered_coach', { p_coach_id: created, p_team_role: role, p_team_name: 'Synthetic Team', p_invite_code: role === 'head_coach' ? '' : invite }], 'Service initialization verifies the team role/invite');
  }
  {
    const f = fixture('create-jkcrew-account', { approval: 'pending' }); const response = await f.invoke({ ...base, role: 'athlete' }, 'user');
    eq(response.status, 403, 'Pending coaches cannot register students through the service endpoint');
    eq(f.calls.filter(call => call[0] === 'create').length, 0, 'A pending coach creates no student');
  }
  {
    const f = fixture('create-jkcrew-account'); const response = await f.invoke({ ...base, role: 'athlete', registeredCoachId: target, registered_coach_id: target }, 'user');
    eq(response.status, 201, 'Approved coaches retain student registration');
    eq(f.calls.find(call => call[0] === 'create')[1].app_metadata, { role: 'athlete', registered_coach_id: actor }, 'Registration owner comes from verified Auth, never request data');
  }
  for (const role of ['athlete', 'parent']) {
    const f = fixture('create-jkcrew-account'); const response = await f.invoke({ ...base, role, inviteCode: invite });
    eq(response.status, 201, 'A family account can use a role-specific private team invitation');
    eq(f.calls.find(call => call[0] === 'admin-rpc').slice(1), ['initialize_registered_team_member', { p_user_id: created, p_role: role, p_invite_code: invite }], 'Family invite admission is server-validated');
  }
  {
    const f = fixture('create-jkcrew-account'); await f.invoke({ ...base, role: 'athlete', registeredCoachId: target });
    eq(f.calls.find(call => call[0] === 'create')[1].app_metadata, { role: 'athlete' }, 'Uninvited public accounts cannot choose another team owner');
  }
  {
    const f = fixture('create-jkcrew-account', { initError: true }); const response = await f.invoke({ ...base, teamRole: 'coach', inviteCode: invite });
    eq(response.status, 400, 'Invalid or consumed invitation does not report a usable account');
    eq(f.calls.filter(call => call[0] === 'delete'), [['delete', created]], 'Failed initialization rolls back only the newly created user');
  }
  for (const mode of [{ profileError: true }, { createError: true }]) {
    const f = fixture('create-jkcrew-account', mode); const response = await f.invoke(base);
    eq(Boolean(response.body.error), true, 'Auth/profile failure is reported');
    eq(f.calls.filter(call => call[0] === 'admin-rpc').length, 0, 'No team access is initialized after failure');
  }
  {
    const f = fixture('create-jkcrew-account'); eq((await f.invoke(base, 'forged')).status, 401, 'Forged caller tokens cannot use privileged registration');
    eq(f.calls.filter(call => call[0] === 'create').length, 0, 'A forged caller creates no account');
  }
  for (const mode of [{ approval: 'pending' }, { approval: 'suspended' }, { permitted: false }, { prepared: false }, { preparationError: true }, { targetRole: 'coach' }, { missingTarget: true }]) {
    const f = fixture('delete-jkcrew-user', mode); const response = await f.invoke({ userId: target }, 'user');
    eq(response.status, 403, 'Unapproved, foreign, changed or privileged accounts cannot be deleted');
    eq(f.calls.filter(call => call[0] === 'delete').length, 0, 'Denied deletion never reaches Auth admin');
  }
  {
    const f = fixture('delete-jkcrew-user'); const response = await f.invoke({ userId: target }, 'user');
    eq(response.body.deleted, true, 'An authorized own-team student deletion succeeds');
    const sequence = f.calls.filter(call => ['user-rpc', 'target-read', 'delete'].includes(call[0])).map(call => call[1]);
    eq(sequence, ['get_my_team_access', 'can_coach_delete_account', 'profiles', 'prepare_coach_account_deletion', target], 'Approval, target scope and session revocation precede Auth deletion');
  }
  {
    const f = fixture('delete-jkcrew-user'); eq((await f.invoke({ userId: actor }, 'user')).status, 400, 'Self-deletion cannot bypass the dedicated account flow');
    eq(f.calls.filter(call => call[0] === 'delete').length, 0, 'Self-deletion performs no admin deletion');
  }
  for (const name of ['create-jkcrew-account', 'delete-jkcrew-user']) {
    const f = fixture(name); eq((await f.invoke(name.startsWith('create') ? base : { userId: target }, 'user', 'https://foreign.example')).status, 403, 'Untrusted origins are rejected');
    eq(f.calls.length, 0, 'Rejected origins do not touch Auth or database clients');
  }
  console.log(`PASS: ${checks} account Edge checks: verified registration ownership, pending coach approval, role-specific invitations, rollback, own-team deletion and session revocation ordering. No production writes.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
