#!/usr/bin/env node
// Public read-only endpoints used by UCI's own DataRide rankings page.
// No API keys, browser cookies or rider account data are needed.
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://dataride.uci.org';
const PAGE_SIZE = 40;
export const CATEGORIES = Object.freeze({
  men: { rankingId: 239, categoryId: 22, groupId: 156 },
  women: { rankingId: 241, categoryId: 23, groupId: 157 },
});

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseRankingDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value));
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const timestamp = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === iso ? iso : null;
}

async function fetchJson(path, { fetchImpl = fetch, body, attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${BASE}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        body: body?.toString(),
        signal: AbortSignal.timeout(30000),
      });
      requireValue(response.ok, `UCI returned HTTP ${response.status} for ${path}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise(done => setTimeout(done, 500 * (attempt + 1)));
    }
  }
  throw new Error(`Could not read official UCI rankings: ${lastError.message}`, { cause: lastError });
}

async function latestPublishedMoment(category, seasons, options) {
  const today = options.now.toISOString().slice(0, 10);
  for (const season of seasons) {
    const moments = await fetchJson(`/iframe/GetRankingMoments/?disciplineId=13&disciplineSeasonId=${season.Id}&rankingId=${category.rankingId}`, options);
    requireValue(Array.isArray(moments), 'UCI ranking dates response is invalid');
    const published = moments.map(moment => ({ ...moment, date: parseRankingDate(moment.Name) }))
      .filter(moment => Number.isSafeInteger(moment.Id) && moment.Id > 0 && moment.date && moment.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (published.length) return { season, moment: published[0] };
  }
  throw new Error('UCI has no published ranking date in the available seasons');
}

function rankingBody(category, season, moment, page) {
  const body = new URLSearchParams({
    disciplineId: '13', rankingId: String(category.rankingId), rankingTypeId: '1',
    page: String(page), pageSize: String(PAGE_SIZE), skip: String((page - 1) * PAGE_SIZE), take: String(PAGE_SIZE),
  });
  const filters = { RaceTypeId: 137, CategoryId: category.categoryId, SeasonId: season.Id, MomentId: moment.Id };
  Object.entries(filters).forEach(([field, value], index) => {
    body.set(`filter[filters][${index}][field]`, field);
    body.set(`filter[filters][${index}][value]`, String(value));
  });
  return body;
}

export function normalizeRows(rawRows, momentId, seasonId) {
  const seen = new Set();
  let previousRank = 0;
  let previousPoints = Infinity;
  return rawRows.map((row, index) => {
    requireValue(row.MomentId === momentId && row.DisciplineSeasonId === seasonId, 'UCI returned a different ranking publication during pagination');
    requireValue(row.ObjectTypeId === 1, 'UCI response is not an individual rider ranking');
    requireValue(Number.isSafeInteger(row.Rank) && row.Rank >= 1 && row.Rank >= previousRank, 'UCI ranks are invalid or out of order');
    requireValue(Number.isFinite(row.Points) && row.Points >= 0 && row.Points <= previousPoints, 'UCI points are invalid or out of order');
    requireValue(index !== 0 || row.Rank === 1, 'UCI ranking must start at rank 1');
    const name = String(row.DisplayName || row.FullName || '').trim();
    const nation = String(row.NationName || '').trim();
    requireValue(name.length > 0 && name.length <= 160 && !/[<>\x00-\x1f]/.test(name), 'UCI rider name is missing or invalid');
    requireValue(/^[A-Z*]{3}$/.test(nation), 'UCI rider nation is missing or invalid');
    const uciId = row.UciId == null || row.UciId === 0 ? null : String(row.UciId);
    requireValue(uciId === null || /^\d{11}$/.test(uciId), 'UCI rider ID is invalid');
    const key = uciId || `object:${row.ObjectId}`;
    requireValue(!seen.has(key), 'UCI returned a duplicate rider across ranking pages');
    seen.add(key);
    const change = row.PrecedingRank > 0 ? row.PrecedingRank - row.Rank : null;
    requireValue(change === null || Number.isSafeInteger(change), 'UCI ranking movement is invalid');
    previousRank = row.Rank;
    previousPoints = row.Points;
    return { rank: row.Rank, name, nation, points: row.Points, uciId, change };
  });
}

async function fetchCategory(category, seasons, options) {
  const { season, moment } = await latestPublishedMoment(category, seasons, options);
  const rawRows = [];
  let total;
  for (let page = 1; total === undefined || rawRows.length < total; page += 1) {
    const result = await fetchJson('/iframe/ObjectRankings/', { ...options, body: rankingBody(category, season, moment, page) });
    requireValue(Number.isSafeInteger(result.total) && result.total > 0 && result.total <= 10000, 'UCI returned an empty or invalid ranking total');
    requireValue(total === undefined || total === result.total, 'UCI ranking total changed during pagination');
    total = result.total;
    requireValue(Array.isArray(result.data) && result.data.length === Math.min(PAGE_SIZE, total - rawRows.length), 'UCI returned an incomplete ranking page');
    rawRows.push(...result.data);
  }
  const rows = normalizeRows(rawRows, moment.Id, season.Id);
  const query = new URLSearchParams({
    categoryId: String(category.categoryId), disciplineId: '13', disciplineSeasonId: String(season.Id),
    groupId: String(category.groupId), momentId: String(moment.Id), raceTypeId: '137', rankingTypeId: '1',
  });
  return {
    rankingDate: moment.date,
    sourceUrl: `${BASE}/iframe/RankingDetails/${category.rankingId}?${query}`,
    rows,
  };
}

export function validateProgression(snapshot, previous) {
  if (!previous) return;
  requireValue(previous.schemaVersion === 1 && previous.categories, 'Existing ranking snapshot has an unsupported format');
  for (const key of Object.keys(CATEGORIES)) {
    requireValue(snapshot.categories[key].rankingDate >= previous.categories[key].rankingDate, `Refusing to replace ${key} rankings with an older publication`);
  }
}

export async function fetchRankings({ fetchImpl = fetch, now = new Date(), previous = null, attempts = 3 } = {}) {
  const options = { fetchImpl, now, attempts };
  const response = await fetchJson('/iframe/GetDisciplineSeasons/?disciplineId=13', options);
  requireValue(Array.isArray(response), 'UCI season catalogue is invalid');
  const seasons = response.filter(season => Number.isSafeInteger(season.Id) && Number.isSafeInteger(season.Year) && season.Year <= now.getUTCFullYear())
    .sort((a, b) => b.Year - a.Year);
  requireValue(seasons.length > 0, 'UCI has no usable seasons');
  const categories = {};
  // Fetch categories sequentially and publish neither until both are complete.
  for (const [key, category] of Object.entries(CATEGORIES)) categories[key] = await fetchCategory(category, seasons, options);
  const snapshot = { schemaVersion: 1, checkedAt: now.toISOString(), categories };
  validateProgression(snapshot, previous);
  return snapshot;
}

export async function updateSnapshot(output, options = {}) {
  let previous;
  try { previous = JSON.parse(await readFile(output, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const snapshot = await fetchRankings({ ...options, previous });
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot)}\n`);
    await rename(temporary, output);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return snapshot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') {
    console.error('Usage: node tools/update-uci-rankings.mjs --output data/uci-rankings.json');
    process.exitCode = 1;
  } else {
    try {
      const snapshot = await updateSnapshot(resolve(args[1]));
      for (const [key, category] of Object.entries(snapshot.categories)) console.log(`${key}: ${category.rows.length} riders, official ranking ${category.rankingDate}`);
      console.log(`Verified snapshot written to ${args[1]}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
