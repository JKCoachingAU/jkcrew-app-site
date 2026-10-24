const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../uci-rankings.js'), 'utf8');
const date = new Date().toISOString().slice(0, 10);
const data = (name = 'Official rider') => ({ schemaVersion: 1, eventBreakdowns: {}, checkedAt: new Date().toISOString(), categories: Object.fromEntries(['men', 'women'].map(key => [key, { rankingDate: date, sourceUrl: 'https://dataride.uci.org/iframe/RankingDetails/239', rows: [{ rank: 1, name, nation: 'AUS', points: 123, uciId: '100001' }] }])) });
function client({ stored, blocked = false, reply = async () => ({ ok: true, json: async () => data() }) } = {}) {
  const calls = [], storage = new Map(stored ? [['jkcrew-uci-rankings-v1', JSON.stringify(stored)]] : []);
  const context = { URL, AbortController, Date, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 40)), clearTimeout,
    document: { currentScript: { src: 'https://jkcrew.test/riley-test/uci-rankings.js?v=2' } },
    window: { location: { href: 'https://jkcrew.test/riley-test/' } },
    localStorage: { getItem: k => { if (blocked) throw Error('Blocked'); return storage.get(k); }, setItem: (k, v) => { if (blocked) throw Error('Blocked'); storage.set(k, v); } },
    fetch: (url, options) => { calls.push({ url, options }); return reply(url, options); }
  };
  vm.runInNewContext(source, context);
  return { ...context.window.JKCUciRankings, calls, storage };
}
(async () => {
  const matcher = client();
  const identities = data();
  identities.categories.men.rows[0].uciId = '10124058738';
  identities.categories.women.rows[0].uciId = '10165130053';
  assert.equal(matcher.findRider(identities, '10165130053').categoryKey, 'women');
  assert.equal(matcher.findRider(identities, '19999999999'), null, 'Unlisted IDs never match by name');
  assert.equal(matcher.findRider(identities, ''), null, 'Empty IDs never match an arbitrary row');
  identities.categories.men.rows.push({ ...identities.categories.women.rows[0] });
  assert.equal(matcher.findRider(identities, '10165130053'), null, 'Ambiguous identities are not displayed');
  const evidence = data();
  evidence.categories.men.rows[0].uciId = '10124058738';
  evidence.categories.women.rows[0].uciId = '10165130053';
  const original = { status: 'current', category: 'men', rankingDate: date, checkedAt: new Date().toISOString(), sourceUrl: 'https://dataride.uci.org/iframe/RiderRankingDetails/1', totalPoints: 123,
    events: [{id:'one',name:'World Cup',date,placing:2,points:123,classCode:'CDM',className:'World Cup',inclusion:'counted'}, {id:'two',name:'C1 event',date,placing:4,points:50,classCode:'C1',className:'Class 1',inclusion:'outside_best_results'}] };
  evidence.eventBreakdowns['10124058738'] = original;
  assert.equal(matcher.findBreakdown(evidence, '10124058738').events.length, 2, 'Official breakdown retains counted and excluded results');
  assert.equal(matcher.findBreakdown({...evidence,stale:true}, '10124058738').status, 'stale', 'Failed overall refresh cannot present fresh event evidence');
  for (const change of [
    {category:'women'}, {totalPoints:124}, {rankingDate:'2020-01-01'}, {sourceUrl:'https://example.com/uci'},
    {events:[...original.events,original.events[0]]}, {events:[{...original.events[0],points:122}]},
    {events:[{...original.events[0],inclusion:'olympic'}]}, {events:[{...original.events[0],points:null}]},
  ]) {
    evidence.eventBreakdowns['10124058738'] = {...original,...change};
    assert.equal(matcher.findBreakdown(evidence, '10124058738'), null, 'Mismatched or unsafe evidence rejected: '+JSON.stringify(change));
  }
  evidence.eventBreakdowns['10124058738'] = {...original,status:'stale',rankingDate:'2026-01-01'};
  assert.equal(matcher.findBreakdown(evidence, '10124058738').status, 'stale', 'Historical retained evidence explicitly stale');
  assert.equal(matcher.findBreakdown(evidence, '10165130053'), null, 'Missing rider breakdown is not an invented zero');
  let release;
  const single = client({ reply: () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => data() }); }) });
  const first = single.load(), second = single.load(); release();
  assert.equal((await first).categories.men.rows[0].name, 'Official rider'); await second;
  assert.equal(single.calls.length, 1, 'Concurrent tabs share a single public download');
  await single.load(); assert.equal(single.calls.length, 1, 'Warm navigation reuses cached data');
  const forced = single.load({ force: true }); release(); await forced;
  assert.equal(single.calls.length, 2, 'Explicit refresh can bypass cache');
  assert.equal(single.calls[0].options.credentials, 'omit');
  assert.equal(single.calls[0].options.cache, 'no-store');
  assert.equal(single.calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(single.calls[0].options.headers, undefined, 'No Supabase credentials sent to UCI feed');
  const saved = JSON.parse(single.storage.get('jkcrew-uci-rankings-v1'));
  let failRefresh = false;
  const retryStatus = client({ reply: async () => { if (failRefresh) throw Error('Offline'); return { ok: true, json: async () => data() }; } });
  await retryStatus.load(); failRefresh = true;
  assert.equal((await retryStatus.load({ force: true })).stale, true);
  assert.equal((await retryStatus.load()).stale, true, 'A tab switch preserves the last refresh failure warning');
  failRefresh = false;
  assert.equal((await retryStatus.load({ force: true })).stale, false, 'Successful retry clears warning');
  const restored = client({ stored: saved }); await restored.load();
  assert.equal(restored.calls.length, 0, 'Refresh restores recent public snapshot');
  const aggregateOnly = data(); delete aggregateOnly.eventBreakdowns;
  const upgraded = client({stored:{data:aggregateOnly,loadedAt:Date.now()}}); await upgraded.load();
  assert.equal(upgraded.calls.length, 1, 'Aggregate-only pre-release cache refreshes for new event evidence');
  const old = { data: data(), loadedAt: 1 };
  const offline = client({ stored: old, reply: async () => { throw Error('Offline'); } });
  assert.equal((await offline.load()).stale, true, 'Offline results are labelled cached');
  assert.equal(offline.calls.length, 1, 'Offline stored snapshot needs no seed download');
  const seed = client({ reply: async url => url.includes('raw.githubusercontent') ? { ok: false } : { ok: true, json: async () => data('Bundled rider') } });
  assert.equal((await seed.load()).categories.men.rows[0].name, 'Bundled rider');
  assert.equal(seed.calls[1].url, 'https://jkcrew.test/riley-test/data/uci-rankings.json', 'Seed respects deployment subdirectory');
  assert.equal((await seed.load()).stale, true);
  const broken = client({ reply: async () => ({ ok: true, json: async () => ({ schemaVersion: 1 }) }) });
  await assert.rejects(broken.load(), /couldn’t load/);
  const blocked = client({ blocked: true });
  assert.equal((await blocked.load()).stale, false, 'Blocked localStorage does not block rankings');
  const future = data(); future.checkedAt = '2099-01-01T00:00:00Z';
  const invalid = client({ stored: old, reply: async () => ({ ok: true, json: async () => future }) });
  assert.equal((await invalid.load()).stale, true, 'Invalid remote data retains last good data');
  const older = data(); older.categories.men.rankingDate = '2025-01-01';
  const regression = client({ stored: old, reply: async () => ({ ok: true, json: async () => older }) });
  assert.equal((await regression.load()).categories.men.rankingDate, date, 'An older upstream snapshot cannot overwrite a newer category');
  const timeout = client({ stored: old, reply: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('Timed out')))) });
  assert.equal((await timeout.load()).stale, true, 'Stalled network recovers to stored data');
  const stale = data(); stale.checkedAt = new Date(Date.now() - 4 * 86400000).toISOString();
  const delayed = client({ reply: async () => ({ ok: true, json: async () => stale }) });
  assert.equal((await delayed.load()).stale, true, 'Delayed scheduler is visible even when feed is reachable');
  console.log('PASS UCI client: lazy requests, deduplication, persistence, retry, timeout, seed, validation and no rollback.');
})().catch(error => { console.error(error); process.exit(1); });
