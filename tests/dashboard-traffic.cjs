const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const extract = name => {
  const match = app.match(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(match, `${name} exists`);
  const text = app.slice(match.index);
  return text.slice(0, text.indexOf('\n}') + 2);
};
let now = 100000, fail = '', hold = null;
let calls = [], signed = 0, bytes = 0;
const clip = 'data:video/mp4;base64,' + 'A'.repeat(256 * 1024);
const rows = Array.from({ length: 405 }, (_, index) => ({
  id: String(index).padStart(5, '0'), athlete_id: 'rider', coach_id: 'coach', question: `Clip ${index}`,
  coach_comment: index % 2 ? 'Try looking up.' : '', status: index % 3 ? 'replied' : 'open',
  created_at: new Date(1700000000000 + index).toISOString(), replied_at: index % 3 ? new Date(1700000000000 + index).toISOString() : null,
  video_file_name: 'rider.mp4', coach_video_file_name: 'reply.mp4',
  video_storage_path: index % 2 ? `rider/${index}.mp4` : '', coach_video_storage_path: '',
  video_data_url: clip, coach_video_data_url: index % 3 ? clip : '',
}));
const profiles = Array.from({ length: 12 }, (_, index) => ({ id: `r${index}`, display_name: `Rider ${index}`, country_code: 'AU', role: 'athlete', level: 2, avatar: 'data:image/png;base64,' + 'B'.repeat(32 * 1024), goals: 'Goals', email: 'private@example.com', last_app_opened_at: null }));
const sessions = profiles.flatMap(profile => Array.from({ length: 3 }, (_, index) => ({ id: `${profile.id}:${index}`, athlete_id: profile.id, total_points: 7, started_at: '2026-09-21', notes: 'old activity '.repeat(100) })));
const tableRows = {
  trick_help_requests: rows,
  profiles,
  coach_athletes: profiles.map(p => ({ athlete_id: p.id, coach_id: 'coach', group_name: 'monday' })),
  coach_athlete_groups: profiles.map(p => ({ athlete_id: p.id, coach_id: 'coach', group_name: 'monday', membership_type: 'member' })),
  training_sessions: sessions,
};
class Query {
  constructor(table) { this.table = table; this.ops = []; }
  select(value) { this.columns = value; this.ops.push(['select', value]); return this; }
  eq(...args) { this.ops.push(['eq', ...args]); return this; }
  in(...args) { this.ops.push(['in', ...args]); return this; }
  order(...args) { this.ops.push(['order', ...args]); return this; }
  range(...args) { this.ops.push(['range', ...args]); return this; }
  limit(value) { this.ops.push(['limit', value]); return this; }
  gte(...args) { this.ops.push(['gte', ...args]); return this; }
  async then(resolve, reject) {
    try {
      calls.push({ table: this.table, ops: this.ops, columns: this.columns });
      if (hold) await hold;
      if (fail === this.table) return resolve({ error: new Error('Connection interrupted'), data: null });
      let data = tableRows[this.table].slice();
      for (const [op, a, b] of this.ops) {
        if (op === 'eq') data = data.filter(row => row[a] === b);
        if (op === 'in') data = data.filter(row => b.includes(row[a]));
        if (op === 'order') data.sort((x, y) => String(x[a]).localeCompare(String(y[a])) * (b?.ascending === false ? -1 : 1));
        if (op === 'range') data = data.slice(a, b + 1);
        if (op === 'limit') data = data.slice(0, a);
      }
      if (this.columns !== '*') data = data.map(row => Object.fromEntries(this.columns.split(',').map(key => key.trim()).map(key => [key, row[key]])));
      bytes += Buffer.byteLength(JSON.stringify(data));
      resolve({ data, error: null });
    } catch (error) { reject(error); }
  }
}
const context = {
  Map, Set, console, Date: class extends Date { static now() { return now; } },
  state: { user: { id: 'coach' }, profile: { role: 'coach' }, cache: {}, inFlight: new Map(), videoReviewMedia: new Map() },
  client: { from: table => new Query(table) },
  PROFILE_SELECT: app.match(/^const PROFILE_SELECT = "([^"]+)";/m)[1],
  HELP_VIDEO_SIGNED_URL_SECONDS: 3600,
  weekStartIso: () => '2026-09-21',
  hydrateHelpRequestMediaUrls: async entries => Promise.all(entries.map(async row => {
    const result = { ...row, video_url: row.video_data_url || '', coach_video_url: row.coach_video_data_url || '' };
    if (row.video_storage_path) { signed++; result.video_url = 'https://example.invalid/private/rider.mp4'; }
    if (row.coach_video_storage_path) { signed++; result.coach_video_url = 'https://example.invalid/private/reply.mp4'; }
    return result;
  })),
};
vm.createContext(context);
vm.runInContext(['cacheGet', 'cacheSet', 'cacheClear', 'invalidateHelpRequestData', 'getHelpRequests', 'getCoachRoster', 'fetchHelpVideoMedia', 'athleteHelpHasReply'].map(extract).join('\n'), context);
(async () => {
  let release;
  hold = new Promise(resolve => { release = resolve; });
  const reads = [context.getHelpRequests('rider'), context.getHelpRequests('rider')];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1, 'Concurrent summaries share one request');
  release(); hold = null;
  const [first, second] = await Promise.all(reads);
  assert.strictEqual(first, second);
  assert.equal(first.length, 405, 'Metadata pagination preserves full history and totals');
  assert.equal(calls.length, 3, 'Metadata pages bounded to 200 rows');
  assert(calls.every(call => !call.columns.includes('video_data_url') && call.columns !== '*'));
  assert(calls.every(call => call.ops.some(op => op[0] === 'eq' && op[1] === 'athlete_id' && op[2] === 'rider')), 'Each metadata page remains rider-scoped under RLS');
  assert.equal(signed, 0, 'No media signing before user opens video');
  const legacyReply = first.find(row => row.id === '00002');
  assert.equal(context.athleteHelpHasReply(legacyReply), true, 'Legacy video-only replies remain returned feedback via saved status');
  assert.equal(legacyReply.video_data_url, undefined, 'No legacy clip bytes in summaries');
  await context.getHelpRequests('rider'); assert.equal(calls.length, 3, 'Fresh cache suppresses repeated screen downloads');
  const metadataBytes = bytes, oldBytes = Buffer.byteLength(JSON.stringify(rows));
  console.log(`Synthetic 405-review metadata: ${oldBytes.toLocaleString()} -> ${metadataBytes.toLocaleString()} bytes (${(100 * (1 - metadataBytes / oldBytes)).toFixed(2)}% less; 0 signed-media requests).`);
  context.invalidateHelpRequestData(); fail = 'trick_help_requests';
  await assert.rejects(context.getHelpRequests('rider'), /Connection interrupted/);
  assert.equal(context.state.inFlight.size, 0, 'Failed read releases in-flight lock');
  fail = ''; await context.getHelpRequests('rider');
  assert(context.state.cache['help-requests:coach:rider'], 'Retry populates metadata cache');
  context.invalidateHelpRequestData(); hold = new Promise(resolve => { release = resolve; });
  const stale = context.getHelpRequests('rider'); await new Promise(resolve => setImmediate(resolve));
  context.invalidateHelpRequestData(); release(); hold = null; await stale;
  assert.equal(context.state.cache['help-requests:coach:rider'], undefined, 'Invalidated in-flight metadata cannot repopulate stale cache');
  calls = []; signed = 0;
  await Promise.all([context.fetchHelpVideoMedia('00001'), context.fetchHelpVideoMedia('00001')]);
  assert.equal(calls.length, 1, 'Repeated open fetches one private review'); assert.equal(signed, 1);
  await context.fetchHelpVideoMedia('00001'); assert.equal(calls.length, 1, 'Fresh signed media reused');
  now += 3600000; await context.fetchHelpVideoMedia('00001'); assert.equal(calls.length, 2, 'Expired signed URL refreshed');
  const legacy = await context.fetchHelpVideoMedia('00002'); assert.equal(legacy.video_url, clip); assert.equal(legacy.coach_video_url, clip, 'Both legacy clips still playable on demand');
  hold = new Promise(resolve => { release = resolve; });
  const privateRead = context.fetchHelpVideoMedia('00003'); await new Promise(resolve => setImmediate(resolve));
  context.state.user.id = 'different-parent'; release(); hold = null;
  await assert.rejects(privateRead, /account changed/);
  assert(!context.state.videoReviewMedia.has('00003'), 'Late media cannot populate another signed-in account');
  context.state.user.id = 'coach'; context.state.cache = {}; calls = []; bytes = 0;
  for (const tick of [0, 20000, 40000]) { now = 5000000 + tick; await context.getCoachRoster(); }
  const oldRosterCalls = calls.length, oldRosterBytes = bytes;
  context.state.cache = {}; calls = []; bytes = 0;
  for (const tick of [0, 20000, 40000]) { now = 5000000 + tick; await context.getCoachRoster({ summary: true, maxAgeMs: 60000 }); }
  assert.equal(oldRosterCalls, 12); assert.equal(calls.length, 3, 'Visible battle minute makes 3 roster queries instead of12');
  assert(!calls.some(call => call.table === 'training_sessions'), 'Battle names do not download training session history');
  assert(!calls.find(call => call.table === 'profiles').columns.includes('avatar'), 'No avatar/base64 blobs on score polling');
  console.log(`Synthetic 12-rider battle roster / 3 polls: ${oldRosterCalls} -> ${calls.length} queries; ${oldRosterBytes.toLocaleString()} -> ${bytes.toLocaleString()} bytes (${(100 * (1 - bytes / oldRosterBytes)).toFixed(2)}% less). Score/challenge queries remain live.`);
  now += 25000; await context.getCoachRoster({ summary: true, maxAgeMs: 60000 }); assert.equal(calls.length, 6, 'Roster refreshes after TTL');
  context.cacheClear('roster:'); await context.getCoachRoster({ summary: true, maxAgeMs: 60000 }); assert.equal(calls.length, 9, 'Membership/profile invalidation bypasses roster TTL');
  assert(extract('renderCoachBattleViewer').includes('getCoachRoster({ summary: true, maxAgeMs: 60000 })'));
  console.log('PASS: role-scoped metadata, pagination, deduplication, invalidation, failure/retry, legacy and signed media, session-switch privacy, and lightweight battle polling.');
})().catch(error => { console.error(error); process.exit(1); });
