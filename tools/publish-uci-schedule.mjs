#!/usr/bin/env node
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSnapshot } from './uci-schedule.mjs';

const repository = 'JKCoachingAU/jkcrew-app-site';
const branch = 'uci-schedule';
const path = 'schedule.json';
export function validatePublication(content, previous = null, now = Date.now()) {
  if (Buffer.byteLength(content) > 1_500_000) throw new Error('Schedule snapshot is too large');
  const parsed = JSON.parse(content);
  const checkedAt = Date.parse(parsed?.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > now + 300_000 || checkedAt < now - 3_600_000) throw new Error('Source check is not from this run');
  const snapshot = validateSnapshot(parsed);
  if (!snapshot.events.length || snapshot.events.length > 500) throw new Error('Unexpected schedule size');
  if (!['ok', 'partial'].includes(snapshot.refreshStatus)) throw new Error('Missing refresh result');
  if (previous) {
    if (Date.parse(previous.checkedAt) > checkedAt) throw new Error('Refusing an older check');
    if (previous.lastSuccessfulCalendarCheckAt && (!snapshot.lastSuccessfulCalendarCheckAt ||
        Date.parse(previous.lastSuccessfulCalendarCheckAt) > Date.parse(snapshot.lastSuccessfulCalendarCheckAt))) {
      throw new Error('Refusing to roll back the successful calendar check');
    }
    const ids = new Set(snapshot.events.flatMap(event => [event.id, ...(event.aliases || [])]));
    for (const event of previous.events || []) if (!ids.has(event.id)) throw new Error('An existing event was removed instead of flagged');
  }
  return snapshot;
}

export async function run(mode, output, { fetchImpl = fetch, env = process.env } = {}) {
  if (env.GITHUB_REPOSITORY !== repository || !env.GH_TOKEN) throw new Error('Expected publishing repository and GitHub credential');
  if (!['restore', 'publish'].includes(mode)) throw new Error('Use restore or publish');
  const api = async (suffix, method = 'GET', body) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/${suffix}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (Number(response.headers.get('content-length') || 0) > 2_500_000) throw new Error('GitHub response too large');
    const text = await response.text();
    if (Buffer.byteLength(text) > 2_500_000) throw new Error('GitHub response too large');
    return { ok: response.ok, status: response.status, data: JSON.parse(text) };
  };
  const requireSuccess = (result, operation) => {
    if (!result.ok) throw new Error(`${operation} failed (HTTP ${result.status})`);
    return result.data;
  };
  const existing = await api(`contents/${path}?ref=${branch}`);
  if (!existing.ok && existing.status !== 404) requireSuccess(existing, 'Reading last published schedule');
  const oldContent = existing.ok ? Buffer.from(existing.data.content, 'base64').toString('utf8') : null;
  const previous = oldContent ? validateSnapshot(JSON.parse(oldContent)) : null;
  if (mode === 'restore') {
    // A first run starts from the independently reviewed, committed baseline.
    await writeFile(output, oldContent || await readFile(new URL('../data/uci-schedule.json', import.meta.url), 'utf8'));
    return;
  }
  const content = await readFile(output, 'utf8');
  const snapshot = validatePublication(content, previous);
  let ref = await api(`git/ref/heads/${branch}`);
  if (ref.status === 404) {
    const main = requireSuccess(await api('git/ref/heads/main'), 'Reading main');
    requireSuccess(await api('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: main.object.sha }), 'Creating data branch');
  } else requireSuccess(ref, 'Reading data branch');
  requireSuccess(await api(`contents/${path}`, 'PUT', {
    message: `Check UCI 2027 Schedule (${snapshot.checkedAt.slice(0, 10)})`, branch,
    content: Buffer.from(content).toString('base64'), ...(existing.ok ? { sha: existing.data.sha } : {}),
  }), 'Publishing schedule');
  const verified = requireSuccess(await api(`contents/${path}?ref=${branch}`), 'Verifying schedule');
  if (Buffer.from(verified.content, 'base64').toString('utf8') !== content) throw new Error('Published content did not match');
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,
    `${snapshot.events.length} events checked at ${snapshot.checkedAt}. Status: ${snapshot.refreshStatus}.\n\n` +
    `Last complete calendar check: ${snapshot.lastSuccessfulCalendarCheckAt || 'not available'}.\n\n` +
    `${snapshot.reviewCandidates?.filter(item => item.status === 'pending').length || 0} official-source changes await evidence review. ` +
    'An automatic source change never becomes an Olympic qualification claim or push notification without review.\n');
  return snapshot;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await run(process.argv[2], resolve(process.argv[3] || '/tmp/uci-schedule.json')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
