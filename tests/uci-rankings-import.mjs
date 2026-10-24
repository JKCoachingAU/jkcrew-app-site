import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fetchRankings, normalizeRows, normalizeEventResults, parseRankingDate, parseResultDate, updateSnapshot, loadPublishedPrevious } from '../tools/update-uci-rankings.mjs';

const NOW = new Date('2026-10-23T00:00:00Z');
function sourceRow(index, { moment = 206159, season = 452 } = {}) {
  return {
    ObjectId: index + 1, ObjectTypeId: 1, Rank: index + 1, PrecedingRank: index + 2,
    UciId: 10000000000 + index, DisplayName: `RIDER ${index + 1}`,
    NationName: 'AUS       ', Points: 5000 - index * 10,
    MomentId: moment, DisciplineSeasonId: season,
  };
}

function source({ patchPage, noCurrentSeason = false, failWomen = false } = {}) {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, options });
    let result;
    if (parsed.pathname.includes('GetDisciplineSeasons')) {
      result = [{ Id: 999, Year: 2027 }, { Id: 452, Year: 2026 }, { Id: 447, Year: 2025 }];
    } else if (parsed.pathname.includes('GetRankingMoments')) {
      const isWomen = parsed.searchParams.get('rankingId') === '241';
      if (noCurrentSeason && parsed.searchParams.get('disciplineSeasonId') === '452') result = [{ Id: 0, Name: 'Most Recent Ranking' }];
      else result = [{ Id: 0, Name: 'Most Recent Ranking' }, { Id: isWomen ? 206160 : 206159, Name: noCurrentSeason ? '30/12/2025' : '20/10/2026' }];
    } else if (parsed.pathname.includes('ObjectRankings')) {
      const body = new URLSearchParams(options.body);
      const women = body.get('rankingId') === '241';
      assert.equal(body.get('disciplineId'), '13');
      assert.equal(body.get('rankingTypeId'), '1');
      const filters = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [body.get(`filter[filters][${index}][field]`), body.get(`filter[filters][${index}][value]`)]));
      assert.equal(filters.RaceTypeId, '137', 'must fetch Park, not Flatland');
      assert.equal(filters.CategoryId, women ? '23' : '22');
      assert.equal(filters.SeasonId, noCurrentSeason ? '447' : '452');
      assert.equal(filters.MomentId, women ? '206160' : '206159');
      if (failWomen && women) return { ok: false, status: 503 };
      const total = women ? 3 : 43;
      const skip = Number(body.get('skip'));
      result = { total, data: Array.from({ length: Math.min(total - skip, 40) }, (_, i) => sourceRow(skip + i, { moment: Number(filters.MomentId), season: Number(filters.SeasonId) })) };
      if (patchPage) patchPage(result, { women, page: Number(body.get('page')) });
    } else throw new Error(`Unexpected source ${url}`);
    return { ok: true, status: 200, json: async () => result };
  };
  return { fetchImpl, requests };
}

test('imports every page, pins official publication and selects Park individual categories', async () => {
  const fixture = source();
  const result = await fetchRankings({ ...fixture, now: NOW, attempts: 1 });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.checkedAt, NOW.toISOString());
  assert.equal(result.categories.men.rows.length, 43);
  assert.equal(result.categories.women.rows.length, 3);
  assert.equal(result.categories.men.rows.at(-1).rank, 43);
  assert.deepEqual(result.categories.men.rows[0], { rank: 1, name: 'RIDER 1', nation: 'AUS', points: 5000, uciId: '10000000000', change: 1 });
  assert.equal(result.categories.men.rankingDate, '2026-10-20');
  assert.match(result.categories.women.sourceUrl, /RankingDetails\/241\?/);
  assert.match(result.categories.women.sourceUrl, /momentId=206160/);
  assert.equal(fixture.requests.filter(item => item.url.pathname.includes('ObjectRankings')).length, 3);
});

test('season rollover uses last published season until new rankings exist', async () => {
  const result = await fetchRankings({ ...source({ noCurrentSeason: true }), now: NOW, attempts: 1 });
  assert.equal(result.categories.men.rankingDate, '2025-12-30');
  assert.match(result.categories.men.sourceUrl, /disciplineSeasonId=447/);
});

test('rejects incomplete, changing and duplicate pages rather than publishing partial rankings', async () => {
  for (const [patchPage, error] of [
    [(result, { page }) => { if (page === 2) result.data.pop(); }, /incomplete/],
    [(result, { page }) => { if (page === 2) result.total += 1; }, /total changed/],
    [(result, { page }) => { if (page === 2) result.data[0].MomentId += 99; }, /different ranking publication/],
    [(result, { page }) => { if (page === 2) result.data[0].UciId = 10000000000; }, /duplicate rider/],
  ]) {
    await assert.rejects(fetchRankings({ ...source({ patchPage }), now: NOW, attempts: 1 }), error);
  }
});

test('rejects malformed data and supports tied ranks and new entries', () => {
  const first = sourceRow(0);
  const second = { ...sourceRow(1), Rank: 1, Points: first.Points, PrecedingRank: 0 };
  assert.equal(normalizeRows([first, second], 206159, 452)[1].change, null);
  assert.throws(() => normalizeRows([{ ...first, ObjectTypeId: 3 }], 206159, 452), /individual rider/);
  assert.throws(() => normalizeRows([{ ...first, Points: NaN }], 206159, 452), /points/);
  assert.throws(() => normalizeRows([{ ...first, DisplayName: '<img onerror=alert(1)>' }], 206159, 452), /name/);
  assert.throws(() => normalizeRows([{ ...first, NationName: '' }], 206159, 452), /nation/);
  assert.equal(parseRankingDate('31/02/2026'), null);
  assert.equal(parseRankingDate('20/10/2026'), '2026-10-20');
});

test('source regression or a failed women feed preserves the existing file byte for byte', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jkcrew-uci-'));
  const path = join(directory, 'rankings.json');
  try {
    const snapshot = await fetchRankings({ ...source(), now: NOW, attempts: 1 });
    await writeFile(path, JSON.stringify(snapshot));
    const before = await readFile(path, 'utf8');
    await assert.rejects(updateSnapshot(path, { ...source({ failWomen: true }), now: NOW, attempts: 1 }), /HTTP 503/);
    assert.equal(await readFile(path, 'utf8'), before);
    snapshot.categories.men.rankingDate = '2026-10-21';
    await writeFile(path, JSON.stringify(snapshot));
    const newer = await readFile(path, 'utf8');
    await assert.rejects(updateSnapshot(path, { ...source(), now: NOW, attempts: 1 }), /older publication/);
    assert.equal(await readFile(path, 'utf8'), newer);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('writes a new complete snapshot after both official categories validate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jkcrew-uci-'));
  try {
    const path = join(directory, 'data', 'rankings.json');
    const snapshot = await updateSnapshot(path, { ...source(), now: NOW, attempts: 1 });
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), snapshot);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function resultRow(id, points, { outside = false, rankingId = 239 } = {}) {
  return { ResultId: id, RankingId: rankingId, IsSpecialResult: false,
    IsInvalidResult: outside, DisplayPoints: `${outside ? '* ' : ''}${points.toFixed(2)}`,
    Points: points, Rank: 3, Date: '15 Oct 2026', ClassCode: 'C1', ClassName: 'Class 1', CompetitionName: `Official event ${id}` };
}

function eventSource({ fail = false, patchEvents, eventCount = 3 } = {}) {
  const base = source({ patchPage(result, { women }) { if (women) result.data.forEach(row => { row.UciId += 1000; }); } });
  const eventRequests = [];
  return { eventRequests, async fetchImpl(url, options) {
    if (!url.includes('/IndividualEventRankings/')) return base.fetchImpl(url, options);
    const body = new URLSearchParams(options.body);
    eventRequests.push(body);
    assert.equal(body.get('disciplineId'), '13');
    assert.equal(body.get('raceTypeId'), '137');
    assert.equal(body.get('baseRankingTypeId'), '1');
    const women = body.get('rankingId') === '241';
    assert.equal(body.get('momentId'), women ? '206160' : '206159');
    assert.equal(body.get('groupId'), women ? '157' : '156');
    assert.equal(body.get('categoryId'), women ? '23' : '22');
    assert.equal(body.get('individualId'), '1');
    if (fail) return { ok: false, status: 503 };
    const rankingId = women ? 241 : 239;
    const all = eventCount === 3 ? [resultRow(1, 3000, { rankingId }), resultRow(2, 2000, { rankingId }), resultRow(3, 120, { outside: true, rankingId })]
      : Array.from({ length: eventCount }, (_, index) => resultRow(index + 1, index === 0 ? 5000 : 0, { rankingId }));
    const skip = Number(body.get('skip'));
    const result = { total: all.length, data: all.slice(skip, skip + 40) };
    if (patchEvents) patchEvents(result, body);
    return { ok: true, json: async () => result };
  } };
}

test('official breakdowns reconcile totals in both categories and preserve explicit outside-best-results flag', async () => {
  const fixture = eventSource();
  const result = await fetchRankings({ ...fixture, trackedUciIds: ['10000000000','10000001000'], now: NOW, attempts: 1 });
  assert.equal(fixture.eventRequests.length, 2);
  for (const id of ['10000000000','10000001000']) {
    const entry = result.eventBreakdowns[id];
    assert.equal(entry.status, 'current');
    assert.equal(entry.totalPoints, 5000);
    assert.equal(entry.rankingDate, '2026-10-20');
    assert.equal(entry.events[2].inclusion, 'outside_best_results');
    assert.equal(entry.events[0].inclusion, 'counted');
    assert.equal(entry.events[0].date, '2026-10-15');
    assert.match(entry.sourceUrl, /RiderRankingDetails\/1\?/);
    assert.equal(entry.events.some(event => 'olympicPoints' in event || 'expiryDate' in event), false);
  }
  assert.equal(result.eventBreakdowns['10000001000'].category, 'women');
});

test('breakdown pagination is complete and bounded', async () => {
  const fixture = eventSource({ eventCount: 43 });
  const result = await fetchRankings({ ...fixture, trackedUciIds: ['10000000000'], now: NOW, attempts: 1 });
  assert.equal(result.eventBreakdowns['10000000000'].events.length, 43);
  assert.equal(fixture.eventRequests.length, 2);
  const invalid = await fetchRankings({ ...eventSource({ eventCount: 201 }), trackedUciIds: ['10000000000'], now: NOW, attempts: 1 });
  assert.equal(invalid.eventBreakdowns['10000000000'].status, 'unavailable');
});

test('one failed breakdown preserves verified historical data and never relabels it as the new publication', async () => {
  const previous = await fetchRankings({ ...eventSource(), trackedUciIds: ['10000000000'], now: NOW, attempts: 1 });
  previous.eventBreakdowns['10000000000'].rankingDate = '2026-10-19';
  const result = await fetchRankings({ ...eventSource({ fail: true }), previous, trackedUciIds: ['10000000000'], now: new Date('2026-10-24T00:00:00Z'), attempts: 1 });
  const entry = result.eventBreakdowns['10000000000'];
  assert.equal(entry.status, 'stale');
  assert.equal(entry.rankingDate, '2026-10-19');
  assert.equal(entry.checkedAt, previous.eventBreakdowns['10000000000'].checkedAt);
  assert.equal(entry.lastAttemptAt, '2026-10-24T00:00:00.000Z');
  assert.deepEqual(entry.events, previous.eventBreakdowns['10000000000'].events);
  assert.equal(result.categories.men.rankingDate, '2026-10-20');
});

test('unknown or ambiguously matched rider produces unavailable history without fetching or guessing identities', async () => {
  const fixture = eventSource();
  const result = await fetchRankings({ ...fixture, trackedUciIds: ['10199999999'], now: NOW, attempts: 1 });
  assert.equal(fixture.eventRequests.length, 0);
  assert.equal(result.eventBreakdowns['10199999999'].status, 'unavailable');
  const ambiguous = await fetchRankings({ ...source(), trackedUciIds: ['10000000000'], now: NOW, attempts: 1 });
  assert.equal(ambiguous.eventBreakdowns['10000000000'].status, 'unavailable');
});

test('mismatched totals, flags, duplicate or incomplete event responses cannot publish current history', async () => {
  const patches = [
    result => { result.data[0].Points += 1; result.data[0].DisplayPoints = '3001.00'; },
    result => { result.data[0].IsInvalidResult = true; },
    result => { result.data[1].ResultId = 1; },
    result => { result.data.pop(); },
    result => { result.data[0].RankingId = 241; },
    result => { result.data[0].CompetitionName = '<script>alert(1)</script>'; },
    result => { result.data[0].Date = '31 Feb 2026'; },
    result => { result.data[0].IsSpecialResult = true; },
  ];
  for (const patchEvents of patches) {
    const result = await fetchRankings({ ...eventSource({ patchEvents }), trackedUciIds: ['10000000000'], now: NOW, attempts: 1 });
    assert.equal(result.eventBreakdowns['10000000000'].status, 'unavailable');
    assert.equal(result.categories.men.rows.length, 43);
  }
});

test('invalid cached breakdowns are discarded while valid rankings remain available', async () => {
  const previous = await fetchRankings({ ...eventSource(), trackedUciIds: ['10000000000'], now: NOW, attempts: 1 });
  previous.eventBreakdowns['10000000000'].events[0].points += 100;
  const result = await fetchRankings({ ...eventSource({ fail: true }), previous, trackedUciIds: ['10000000000'], now: NOW, attempts: 1 });
  assert.equal(result.eventBreakdowns['10000000000'].status, 'unavailable');
  assert.deepEqual(result.eventBreakdowns['10000000000'].events, []);
});

test('result dates and zero-point events are explicit and validated', () => {
  assert.equal(parseResultDate('5 Nov 2025'), '2025-11-05');
  assert.equal(parseResultDate('31 Feb 2026'), null);
  assert.equal(parseResultDate('05 Nov 26'), null);
  assert.equal(normalizeEventResults([resultRow(1, 0)], { rankingId:239, rankingDate:'2026-10-20', totalPoints:0 })[0].points, 0);
  assert.throws(() => normalizeEventResults([resultRow(1, 5)], { rankingId:239, rankingDate:'2026-10-20', totalPoints:6 }), /reconcile/);
});

test('tracked config bounds and duplicate IDs reject before publishing', async () => {
  for (const trackedUciIds of [['10000000000','10000000000'], ['not-an-id'], Array.from({ length: 41 }, (_, i) => String(10000000000 + i))]) {
    await assert.rejects(fetchRankings({ ...eventSource(), trackedUciIds, now: NOW, attempts: 1 }), /Tracked UCI/);
  }
});

test('published previous snapshot is read without credentials; failure or oversize falls back to seed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jkcrew-uci-previous-'));
  try {
    const fallbackPath = join(directory,'seed.json');
    const seed = { schemaVersion:1, categories:{men:{},women:{}}, marker:'seed',
      eventBreakdowns:{'10000000000':{checkedAt:'2026-10-23T00:00:00Z', marker:'seed-history'}} };
    await writeFile(fallbackPath, JSON.stringify(seed));
    const published = { schemaVersion:1, categories:{men:{},women:{}}, marker:'published' };
    const result = await loadPublishedPrevious({ fallbackPath, fetchImpl:async (url, options) => {
      assert.equal(new URL(url).hostname, 'raw.githubusercontent.com');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers, undefined);
      return new Response(JSON.stringify(published));
    } });
    assert.equal(result.marker,'published');
    assert.equal(result.eventBreakdowns['10000000000'].marker,'seed-history', 'older published format must not erase seed history');
    assert.equal((await loadPublishedPrevious({ fallbackPath, fetchImpl:async () => { throw Error('offline'); } })).marker,'seed');
    assert.equal((await loadPublishedPrevious({ fallbackPath, fetchImpl:async () => new Response('x'.repeat(900001)) })).marker,'seed');
  } finally { await rm(directory,{recursive:true,force:true}); }
});
