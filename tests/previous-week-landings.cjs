// Read-only evidence tests. The actual browser module runs in a VM with only
// its private loader/key exposed for testing; every database row is synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(root, 'previous-week-landings.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp('^function ' + name + '\\(', 'm'));
  assert(start >= 0, name + ' exists');
  const source = app.slice(start);
  return source.slice(0, source.indexOf('\n}') + 2);
};
const row = (id, extra = {}) => ({ id, athlete_id: 'rider-a', trick_name: id,
  category: 'one_bang', notes: '', venue: 'Park', landed_count: 1,
  evidence_type: 'progress', landed_at: '2026-09-29T04:00:00Z', landing_date: null, ...extra });
function fixture() {
  let now = Date.parse('2026-10-04T03:00:00Z');
  class Clock extends Date { static now() { return now; } }
  const db = { rows: [], queries: [], fail: false, delay: false, releases: [] };
  const client = { from(table) {
    assert.equal(table, 'tricktionary_landing_history');
    const calls = [];
    db.queries.push(calls);
    let rows = db.rows.map(value => ({ ...value }));
    let from = 0, to = Infinity;
    const query = {};
    query.select = fields => { calls.push(['select', fields]); return query; };
    for (const [method, compare] of Object.entries({
      eq: (a, b) => a === b, neq: (a, b) => a !== b, gt: (a, b) => a > b,
    })) query[method] = (field, value) => {
      calls.push([method, field, value]); rows = rows.filter(item => compare(item[field], value)); return query;
    };
    query.or = expression => {
      calls.push(['or', expression]);
      const match = expression.match(/^and\(landing_date\.gte\.([^,]+),landing_date\.lt\.([^\)]+)\),and\(landing_date\.is\.null,landed_at\.gte\.([^,]+),landed_at\.lt\.([^\)]+)\)$/);
      assert(match, 'Bounded query has explicit-date and null-date timestamp branches');
      rows = rows.filter(item => item.landing_date != null
        ? item.landing_date >= match[1] && item.landing_date < match[2]
        : item.landed_at >= match[3] && item.landed_at < match[4]);
      return query;
    };
    query.order = (field, options) => {
      calls.push(['order', field, options]);
      rows.sort((a, b) => String(a[field]).localeCompare(String(b[field])));
      return query;
    };
    query.range = (first, last) => { calls.push(['range', first, last]); from = first; to = last; return query; };
    query.abortSignal = signal => { assert(signal instanceof AbortSignal); return query; };
    query.then = (resolve, reject) => {
      const result = db.fail ? { data: null, error: Error('History unavailable') } : { data: rows.slice(from, to + 1), error: null };
      return (db.delay ? new Promise(done => db.releases.push(() => done(result))) : Promise.resolve(result)).then(resolve, reject);
    };
    return query;
  } };
  const context = { window: {}, Date: Clock, Intl, AbortController, setTimeout, clearTimeout,
    countryTimezones: { AU: 'Australia/Brisbane', US: 'America/Los_Angeles', NZ: 'Pacific/Auckland', GB: 'Europe/London' } };
  vm.createContext(context);
  vm.runInContext(['dateForTimezone', 'weekStartDateForCountry', 'tricktionaryLandingDate', 'splitLineTricks', 'assignmentPresentation'].map(extract).join('\n'), context);
  const testedSource = moduleSource.replace('window.JKPreviousWeekLandings = { marker, mount, clear };',
    'window.JKPreviousWeekLandings = { marker, mount, clear }; window.testHistory = { load, key };');
  assert.notEqual(testedSource, moduleSource, 'Expose the private functions without replacing implementation');
  vm.runInContext(testedSource, context);
  const defaults = { client, userId: 'coach-a', athleteId: 'rider-a', countryCode: 'AU', weekStart: '2026-10-04',
    landingDate: context.tricktionaryLandingDate, present: context.assignmentPresentation };
  return { db, context, load: options => context.window.testHistory.load({ ...defaults, ...options }),
    clear: context.window.JKPreviousWeekLandings.clear, advance: ms => { now += ms; } };
}
const sorted = set => Array.from(set).sort();
const flush = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  const dates = fixture();
  const boundary = new Date('2026-10-03T14:00:00Z');
  assert.equal(dates.context.weekStartDateForCountry('AU', boundary), '2026-10-04');
  assert.equal(dates.context.weekStartDateForCountry('US', boundary), '2026-09-27', 'Use the rider country rather than the coach country');
  dates.db.rows = [
    row('before-start', { landed_at: '2026-09-26T13:59:59Z' }),
    row('start-inclusive', { landed_at: '2026-09-26T14:00:00Z' }),
    row('last-second', { landed_at: '2026-10-03T13:59:59Z' }),
    row('end-exclusive', { landed_at: '2026-10-03T14:00:00Z' }),
    row('daily-explicit', { category: 'daily', landing_date: '2026-09-28', landed_at: '2026-10-04T01:00:00Z' }),
    row('daily-old', { category: 'daily', landing_date: '2026-09-26' }),
    row('daily-current', { category: 'daily', landing_date: '2026-10-04' }),
  ];
  assert.deepEqual(sorted(await dates.load()), ['trick:daily-explicit', 'trick:last-second', 'trick:start-inclusive']);
  const usa = fixture();
  usa.db.rows = [row('us-start', { landed_at: '2026-09-27T07:00:00Z' }), row('us-before', { landed_at: '2026-09-27T06:59:59Z' }),
    row('us-last', { landed_at: '2026-10-04T06:59:59Z' }), row('us-end', { landed_at: '2026-10-04T07:00:00Z' })];
  assert.deepEqual(sorted(await usa.load({ countryCode: 'US' })), ['trick:us-last', 'trick:us-start']);
  const dst = fixture();
  dst.db.rows = [row('nz-start', { landed_at: '2026-09-26T12:00:00Z' }), row('nz-end', { landed_at: '2026-10-03T11:00:00Z' }),
    row('nz-last', { landed_at: '2026-10-03T10:59:59Z' })];
  assert.deepEqual(sorted(await dst.load({ countryCode: 'NZ' })), ['trick:nz-last', 'trick:nz-start'], 'Local date matching spans daylight-saving offset change');

  const evidence = fixture();
  evidence.db.rows = [row('landed-percentage', { category: 'percentage', evidence_type: 'percentage' }),
    row('missed-percentage', { category: 'percentage', landed_count: 0 }), row('revoked', { evidence_type: 'revoked' }),
    row('foam-category', { category: 'foam_pit' }), row('foam-name', { trick_name: 'Flair foam' }),
    row('foam-notes', { notes: 'Use foam pit' }), row('foam-venue', { venue: 'Foam pit' }),
    row('other-rider', { athlete_id: 'rider-b' }), row('name-normalized', { trick_name: '  Oppo   BARSPIN ' }),
    row('line-legacy', { category: 'lines', trick_name: 'Manual', notes: 'Barspin - 180' }),
    row('line-pipes', { category: 'lines', trick_name: 'Manual | Barspin | 180' }),
    row('line-different', { category: 'lines', trick_name: 'Manual', notes: 'Tailwhip - 180' }),
    row('line-single', { trick_name: 'Manual' })];
  assert.deepEqual(sorted(await evidence.load()), ['line:manual → barspin → 180', 'line:manual → tailwhip → 180',
    'trick:landed-percentage', 'trick:manual', 'trick:oppo barspin']);
  const operations = evidence.db.queries[0];
  for (const expected of [['eq', 'athlete_id', 'rider-a'], ['gt', 'landed_count', 0], ['neq', 'evidence_type', 'revoked'], ['neq', 'category', 'foam_pit']]) {
    assert(operations.some(call => JSON.stringify(call) === JSON.stringify(expected)), 'Query filters ' + expected.join(' '));
  }
  const marker = evidence.context.window.JKPreviousWeekLandings.marker(row('unsafe', { trick_name: '\"<img src=x onerror=1>&' }));
  assert(marker.includes('&quot;&lt;img src=x onerror=1&gt;&amp;'), 'History marker data is HTML escaped');
  assert(!marker.includes('<img'), 'Names cannot inject markup');

  const pages = fixture();
  pages.db.rows = Array.from({ length: 805 }, (_, index) => row('trick-' + String(index).padStart(4, '0')));
  assert.equal((await pages.load()).size, 805, 'Read every result page');
  assert.deepEqual(pages.db.queries.map(calls => calls.find(call => call[0] === 'range')), [['range', 0, 399], ['range', 400, 799], ['range', 800, 1199]]);
  await pages.load(); assert.equal(pages.db.queries.length, 3, 'List switches reuse successful rider/week results');
  pages.advance(5 * 60 * 1000 + 1);
  await pages.load(); assert.equal(pages.db.queries.length, 6, 'Expired evidence is fetched again');
  await pages.load({ weekStart: '2026-10-11' }); assert.equal(pages.db.queries.length, 7, 'Week rollover has a separate cache key');
  await pages.load({ countryCode: 'NZ', weekStart: '2026-10-11' }); assert.equal(pages.db.queries.length, 8, 'Country changes cannot reuse old week bounds');

  const shared = fixture(); shared.db.rows = [row('same-rider')]; shared.db.delay = true;
  const first = shared.load(), duplicate = shared.load();
  await flush(); assert.equal(shared.db.queries.length, 1, 'Concurrent same-rider loads share one request');
  shared.db.releases.shift()();
  assert.deepEqual(sorted(await first), sorted(await duplicate));
  shared.db.delay = false;
  await shared.load({ athleteId: 'rider-b' }); assert.equal(shared.db.queries.length, 2, 'Each rider has a separate cache');
  await shared.load({ userId: 'coach-b' }); assert.equal(shared.db.queries.length, 3, 'Another account cannot reuse private evidence');
  await shared.load(); assert.equal(shared.db.queries.length, 4, 'Returning account must fetch after cache reset');

  const late = fixture(); late.db.delay = true; late.db.rows = [row('earlier-account')];
  const old = late.load(); await flush();
  late.db.delay = false; late.db.rows = [row('newer-account')];
  await late.load({ userId: 'coach-b' });
  late.db.releases.shift()(); await old;
  assert.deepEqual(sorted(await late.load()), ['trick:newer-account'], 'Late old-account results do not repopulate cleared cache');

  const returned = fixture(); returned.db.delay = true; returned.db.rows = [row('stale-before-switch')];
  const stale = returned.load(); await flush();
  returned.db.delay = false; returned.db.rows = [row('fresh-after-switch')];
  await returned.load({ userId: 'coach-b' });
  await returned.load();
  returned.db.releases.shift()(); await stale;
  assert.deepEqual(sorted(await returned.load()), ['trick:fresh-after-switch'], 'A late request cannot overwrite fresh evidence after switching away and back');

  const retry = fixture(); retry.db.fail = true;
  await assert.rejects(retry.load(), /History unavailable/);
  retry.db.fail = false; retry.db.rows = [row('recovered')];
  assert.deepEqual(sorted(await retry.load()), ['trick:recovered'], 'A failed query is not cached and retry starts a fresh read');
  assert.equal(retry.db.queries.length, 2);
  retry.clear(); await retry.load(); assert.equal(retry.db.queries.length, 3, 'Explicit clear invalidates successful cache');
  console.log('PASS: previous-week country/Sunday/DST bounds, explicit Daily dates, landed evidence, foam exclusion, full Lines, escaped markers, pagination, TTL, deduplication, rider/account isolation and retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });
