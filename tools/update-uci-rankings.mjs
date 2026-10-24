#!/usr/bin/env node
// Public read-only endpoints used by UCI's own DataRide rankings page.
// No API keys, browser cookies or rider account data are needed.
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://dataride.uci.org';
const PAGE_SIZE = 40;
const MAX_TRACKED_RIDERS = 40;
const MAX_EVENT_RESULTS = 200;
const PUBLISHED_SNAPSHOT = 'https://raw.githubusercontent.com/JKCoachingAU/jkcrew-app-site/refs/heads/uci-rankings/rankings.json';
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

async function fetchJson(path, { fetchImpl = fetch, body, attempts = 3, timeoutMs = 30000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${BASE}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        body: body?.toString(),
        signal: AbortSignal.timeout(timeoutMs),
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
  const ranking = {
    rankingDate: moment.date,
    sourceUrl: `${BASE}/iframe/RankingDetails/${category.rankingId}?${query}`,
    rows,
  };
  return { ranking, rawRows, season, moment };
}

export function parseResultDate(value) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const match = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(String(value));
  if (!match || !months.includes(match[2])) return null;
  return parseRankingDate(`${match[1].padStart(2, '0')}/${String(months.indexOf(match[2]) + 1).padStart(2, '0')}/${match[3]}`);
}

function plainText(value, limit = 240) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[<>\x00-\x1f]/.test(value), 'UCI result text is missing or invalid');
  return value.trim();
}

export function normalizeEventResults(rawRows, { rankingId, rankingDate, totalPoints }) {
  requireValue(Array.isArray(rawRows) && rawRows.length <= MAX_EVENT_RESULTS, 'UCI event results are invalid or too numerous');
  const seen = new Set();
  const events = rawRows.map(row => {
    requireValue(Number.isSafeInteger(row.ResultId) && row.ResultId > 0 && !seen.has(row.ResultId), 'UCI result ID is invalid or duplicated');
    seen.add(row.ResultId);
    requireValue(row.RankingId === rankingId, 'UCI event result belongs to a different ranking');
    requireValue(row.IsSpecialResult === false, 'Unsupported UCI special result requires review');
    requireValue(typeof row.IsInvalidResult === 'boolean', 'UCI event inclusion flag is missing');
    requireValue(Number.isFinite(row.Points) && row.Points >= 0 && row.Points <= 100000, 'UCI event points are invalid');
    requireValue(Number.isSafeInteger(row.Rank) && row.Rank > 0 && row.Rank <= 10000, 'UCI event placing is invalid');
    requireValue(typeof row.DisplayPoints === 'string' && /^\*?\s*\d+(?:\.\d+)?$/.test(row.DisplayPoints)
      && row.DisplayPoints.trim().startsWith('*') === row.IsInvalidResult
      && Math.abs(Number(row.DisplayPoints.replace('*', '').trim()) - row.Points) < 0.001, 'UCI display points and inclusion flag disagree');
    const date = parseResultDate(row.Date);
    requireValue(date && date <= rankingDate, 'UCI event date is invalid or after its ranking publication');
    const classCode = plainText(row.ClassCode, 12);
    requireValue(/^[A-Z0-9]+$/.test(classCode), 'UCI event classification is invalid');
    return {
      id: `uci-result-${row.ResultId}`, resultId: row.ResultId,
      name: plainText(row.CompetitionName), classCode, className: plainText(row.ClassName, 100),
      date, placing: row.Rank, points: row.Points,
      // The public UCI rider page explicitly defines its asterisk as "Not amongst best results".
      inclusion: row.IsInvalidResult ? 'outside_best_results' : 'counted',
    };
  });
  const counted = events.filter(event => event.inclusion === 'counted').reduce((sum, event) => sum + event.points, 0);
  requireValue(Number.isFinite(totalPoints) && Math.abs(counted - totalPoints) < 0.01, 'UCI event points do not reconcile with the official ranking total');
  return events.sort((a, b) => b.date.localeCompare(a.date) || a.resultId - b.resultId);
}

function riderSourceUrl(objectId, category, season, moment) {
  const query = new URLSearchParams({ rankingId: String(category.rankingId), groupId: String(category.groupId),
    momentId: String(moment.Id), baseRankingTypeId: '1', disciplineSeasonId: String(season.Id), disciplineId: '13',
    categoryId: String(category.categoryId), raceTypeId: '137', countryId: '0', teamId: '0' });
  return `${BASE}/iframe/RiderRankingDetails/${objectId}?${query}`;
}

async function fetchEventBreakdown(uciId, categoryKey, source, options) {
  const category = CATEGORIES[categoryKey];
  const { ranking, rawRows, season, moment } = source;
  const row = rawRows.find(item => String(item.UciId) === uciId);
  requireValue(Number.isSafeInteger(row?.ObjectId) && row.ObjectId > 0, 'UCI rider identity is unavailable');
  const rawEvents = [];
  let total;
  for (let page = 1; total === undefined || rawEvents.length < total; page += 1) {
    const body = new URLSearchParams({ individualId: String(row.ObjectId), rankingId: String(category.rankingId),
      momentId: String(moment.Id), groupId: String(category.groupId), baseRankingTypeId: '1',
      disciplineSeasonId: String(season.Id), disciplineId: '13', categoryId: String(category.categoryId),
      raceTypeId: '137', countryId: '0', teamId: '0', page: String(page), pageSize: String(PAGE_SIZE),
      skip: String((page - 1) * PAGE_SIZE), take: String(PAGE_SIZE) });
    // Keep optional rider history failures within the existing ten-minute job.
    const result = await fetchJson('/iframe/IndividualEventRankings/', {
      ...options, body, attempts: Math.min(options.attempts, 2), timeoutMs: 15000,
    });
    requireValue(Number.isSafeInteger(result.total) && result.total >= 0 && result.total <= MAX_EVENT_RESULTS, 'UCI event result count is invalid');
    requireValue(total === undefined || total === result.total, 'UCI event result total changed during pagination');
    total = result.total;
    requireValue(Array.isArray(result.data) && result.data.length === Math.min(PAGE_SIZE, total - rawEvents.length), 'UCI returned an incomplete event-results page');
    rawEvents.push(...result.data);
  }
  return { status: 'current', category: categoryKey, rankingDate: ranking.rankingDate,
    checkedAt: options.now.toISOString(), lastAttemptAt: options.now.toISOString(),
    sourceUrl: riderSourceUrl(row.ObjectId, category, season, moment), totalPoints: row.Points,
    events: normalizeEventResults(rawEvents, { rankingId: category.rankingId, rankingDate: ranking.rankingDate, totalPoints: row.Points }) };
}

function previousBreakdown(value, now) {
  if (!value || !['current', 'stale'].includes(value.status) || !CATEGORIES[value.category]
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.rankingDate || '')
    || parseRankingDate(`${value.rankingDate.slice(8)}/${value.rankingDate.slice(5,7)}/${value.rankingDate.slice(0,4)}`) !== value.rankingDate
    || value.rankingDate > now.toISOString().slice(0, 10)
    || !Number.isFinite(Date.parse(value.checkedAt)) || Date.parse(value.checkedAt) > now.getTime()
    || !Array.isArray(value.events) || value.events.length > MAX_EVENT_RESULTS) return null;
  try {
    const url = new URL(value.sourceUrl);
    requireValue(url.origin === BASE && /^\/iframe\/RiderRankingDetails\/\d+$/.test(url.pathname), 'Invalid cached rider source');
    for (const [key, expected] of Object.entries({ rankingId: CATEGORIES[value.category].rankingId,
      groupId: CATEGORIES[value.category].groupId, categoryId: CATEGORIES[value.category].categoryId,
      disciplineId: 13, raceTypeId: 137, baseRankingTypeId: 1 })) {
      requireValue(url.searchParams.get(key) === String(expected), 'Cached rider source belongs to a different ranking');
    }
    const events = normalizeEventResults(value.events.map(event => ({ ResultId: event.resultId,
      RankingId: CATEGORIES[value.category].rankingId, IsSpecialResult: false,
      IsInvalidResult: event.inclusion === 'outside_best_results', Points: event.points,
      DisplayPoints: `${event.inclusion === 'outside_best_results' ? '* ' : ''}${event.points}`, Rank: event.placing,
      Date: /^\d{4}-\d{2}-\d{2}$/.test(event.date) ? `${event.date.slice(8)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(event.date.slice(5,7))-1]} ${event.date.slice(0,4)}` : '',
      ClassCode: event.classCode, ClassName: event.className, CompetitionName: event.name })),
    { rankingId: CATEGORIES[value.category].rankingId, rankingDate: value.rankingDate, totalPoints: value.totalPoints });
    requireValue(value.events.every(event => ['counted','outside_best_results'].includes(event.inclusion)), 'Invalid cached event inclusion');
    return { status: 'stale', category: value.category, rankingDate: value.rankingDate, checkedAt: value.checkedAt,
      sourceUrl: value.sourceUrl, totalPoints: value.totalPoints, events };
  } catch { return null; }
}

async function fetchTrackedBreakdowns(sources, trackedUciIds, options, previous) {
  requireValue(Array.isArray(trackedUciIds) && trackedUciIds.length <= MAX_TRACKED_RIDERS
    && trackedUciIds.every(id => typeof id === 'string' && /^\d{11}$/.test(id))
    && new Set(trackedUciIds).size === trackedUciIds.length, 'Tracked UCI rider IDs are invalid or duplicated');
  const records = {};
  for (const uciId of trackedUciIds) {
    const matches = Object.entries(sources).filter(([, source]) => source.rawRows.some(row => String(row.UciId) === uciId));
    try {
      requireValue(matches.length === 1, matches.length ? 'UCI rider appears in multiple categories' : 'Rider is absent from this UCI publication');
      records[uciId] = await fetchEventBreakdown(uciId, matches[0][0], matches[0][1], options);
    } catch (error) {
      const cached = previousBreakdown(previous?.eventBreakdowns?.[uciId], options.now);
      records[uciId] = { ...(cached || { status: 'unavailable', events: [] }),
        lastAttemptAt: options.now.toISOString(), reason: String(error.message).slice(0, 240) };
    }
  }
  return records;
}

export function validateProgression(snapshot, previous) {
  if (!previous) return;
  requireValue(previous.schemaVersion === 1 && previous.categories, 'Existing ranking snapshot has an unsupported format');
  for (const key of Object.keys(CATEGORIES)) {
    requireValue(snapshot.categories[key].rankingDate >= previous.categories[key].rankingDate, `Refusing to replace ${key} rankings with an older publication`);
  }
}

export async function fetchRankings({ fetchImpl = fetch, now = new Date(), previous = null, attempts = 3, trackedUciIds = [] } = {}) {
  const options = { fetchImpl, now, attempts };
  const response = await fetchJson('/iframe/GetDisciplineSeasons/?disciplineId=13', options);
  requireValue(Array.isArray(response), 'UCI season catalogue is invalid');
  const seasons = response.filter(season => Number.isSafeInteger(season.Id) && Number.isSafeInteger(season.Year) && season.Year <= now.getUTCFullYear())
    .sort((a, b) => b.Year - a.Year);
  requireValue(seasons.length > 0, 'UCI has no usable seasons');
  const categories = {};
  const sources = {};
  // Fetch categories sequentially and publish neither until both are complete.
  for (const [key, category] of Object.entries(CATEGORIES)) {
    sources[key] = await fetchCategory(category, seasons, options);
    categories[key] = sources[key].ranking;
  }
  const snapshot = { schemaVersion: 1, checkedAt: now.toISOString(), categories };
  validateProgression(snapshot, previous);
  snapshot.eventBreakdowns = await fetchTrackedBreakdowns(sources, trackedUciIds, options, previous);
  return snapshot;
}

export async function updateSnapshot(output, options = {}) {
  let previous = options.previous;
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

export async function loadPublishedPrevious({ fetchImpl = fetch, fallbackPath = new URL('../data/uci-rankings.json', import.meta.url) } = {}) {
  let seed = null;
  try { seed = JSON.parse(await readFile(fallbackPath, 'utf8')); } catch { /* A published snapshot can stand alone. */ }
  try {
    const response = await fetchImpl(PUBLISHED_SNAPSHOT, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    requireValue(response.ok, 'Previous published ranking is unavailable');
    requireValue(Number(response.headers.get('content-length') || 0) <= 900000, 'Previous ranking snapshot is too large');
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        requireValue(bytes <= 900000, 'Previous ranking snapshot is too large');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requireValue(result.schemaVersion === 1 && result.categories?.men && result.categories?.women, 'Invalid previous ranking snapshot');
    // An older publishing workflow may not yet contain event history. Preserve the
    // verified release seed in that case, and choose the latest verified record
    // when the public feed has a failed attempt. Every reused record is validated
    // again before being emitted as stale by fetchTrackedBreakdowns.
    const candidates = { ...seed?.eventBreakdowns, ...result.eventBreakdowns };
    for (const [id, entry] of Object.entries(seed?.eventBreakdowns || {})) {
      if (!candidates[id]?.checkedAt || Date.parse(entry.checkedAt) > Date.parse(candidates[id].checkedAt)) candidates[id] = entry;
    }
    result.eventBreakdowns = candidates;
    return result;
  } catch {
    return seed;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') {
    console.error('Usage: node tools/update-uci-rankings.mjs --output data/uci-rankings.json');
    process.exitCode = 1;
  } else {
    try {
      const config = JSON.parse(await readFile(new URL('../data/uci-tracked-riders.json', import.meta.url), 'utf8'));
      requireValue(config.schemaVersion === 1, 'Unsupported tracked-rider config');
      const previous = await loadPublishedPrevious();
      const snapshot = await updateSnapshot(resolve(args[1]), { previous, trackedUciIds: config.uciIds });
      for (const [key, category] of Object.entries(snapshot.categories)) console.log(`${key}: ${category.rows.length} riders, official ranking ${category.rankingDate}`);
      const results = Object.values(snapshot.eventBreakdowns);
      console.log(`Official event breakdowns: ${results.filter(row => row.status === 'current').length} current, ${results.filter(row => row.status === 'stale').length} retained stale, ${results.filter(row => row.status === 'unavailable').length} unavailable`);
      console.log(`Verified snapshot written to ${args[1]}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
