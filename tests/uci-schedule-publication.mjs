import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePublication, run } from '../tools/publish-uci-schedule.mjs';
const baseline = JSON.parse(await readFile(new URL('../data/uci-schedule.json', import.meta.url), 'utf8'));
const fresh = () => ({ ...structuredClone(baseline), checkedAt: new Date().toISOString() });
let checks = 0;
const rejects = (value, pattern) => { assert.throws(() => validatePublication(JSON.stringify(value)), pattern); checks++; };
assert.equal(validatePublication(JSON.stringify(fresh())).events.length, baseline.events.length); checks++;
rejects({ ...fresh(), checkedAt: '2020-01-01T00:00:00Z' }, /not from this run/);
rejects({ ...fresh(), events: [] }, /Unexpected schedule size/);
rejects({ ...fresh(), refreshStatus: 'made_up' }, /Missing refresh result/);
const fewer = fresh(); fewer.events.pop();
assert.throws(() => validatePublication(JSON.stringify(fewer), baseline), /removed instead of flagged/); checks++;
const partial = fresh(); partial.refreshStatus = 'partial';
assert.equal(validatePublication(JSON.stringify(partial), baseline).refreshStatus, 'partial'); checks++;
const rollback = fresh(); rollback.lastSuccessfulCalendarCheckAt = null;
assert.throws(() => validatePublication(JSON.stringify(rollback), baseline), /roll back/); checks++;
const work = await mkdtemp(join(tmpdir(), 'uci-publish-'));
try {
  const file = join(work, 'snapshot.json');
  const snapshot = fresh(); const content = JSON.stringify(snapshot);
  await writeFile(file, content);
  const calls = [];
  const env = { GITHUB_REPOSITORY: 'JKCoachingAU/jkcrew-app-site', GH_TOKEN: 'synthetic-test-only' };
  const response = (status, data) => new Response(JSON.stringify(data), { status });
  const old = { sha: 'old-sha', content: Buffer.from(JSON.stringify(baseline)).toString('base64') };
  let published = null;
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    assert.equal(options.redirect, 'error');
    if (options.method === 'PUT') {
      published = JSON.parse(options.body);
      assert.equal(published.sha, 'old-sha');
      assert.equal(published.branch, 'uci-schedule');
      return response(200, { commit: { sha: 'new-sha' } });
    }
    if (url.includes('git/ref/')) return response(200, { object: { sha: 'branch-sha' } });
    return response(200, published ? { content: published.content } : old);
  };
  await run('publish', file, { fetchImpl, env }); checks++;
  assert.equal(Buffer.from(published.content, 'base64').toString('utf8'), content); checks++;
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1); checks++;
  assert(calls.every(call => call.url.startsWith('https://api.github.com/repos/JKCoachingAU/jkcrew-app-site/'))); checks++;
  await assert.rejects(() => run('publish', file, { env: { ...env, GITHUB_REPOSITORY: 'wrong/repo' }, fetchImpl }), /Expected publishing/); checks++;
  let writes = 0;
  await assert.rejects(() => run('publish', file, { env, fetchImpl: async (url, options) => {
    if (options.method === 'PUT') { writes++; return response(409, {}); }
    return url.includes('git/ref/') ? response(200, { object: { sha: 'branch-sha' } }) : response(200, old);
  }}), /HTTP 409/); checks++;
  assert.equal(writes, 1, 'A competing publish is never force-overwritten'); checks++;
  const before = calls.length;
  await run('restore', file, { fetchImpl, env });
  assert.equal(calls.length, before + 1, 'Restore only reads the previous snapshot'); checks++;
  await assert.rejects(() => run('restore', file, { env, fetchImpl: async () => response(503, {}) }), /HTTP 503/); checks++;
} finally { await rm(work, { recursive: true, force: true }); }
console.log(`UCI schedule publication: ${checks} checks passed`);
