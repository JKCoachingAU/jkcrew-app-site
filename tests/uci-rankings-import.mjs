import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fetchRankings, normalizeRows, parseRankingDate, updateSnapshot } from '../tools/update-uci-rankings.mjs';

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
