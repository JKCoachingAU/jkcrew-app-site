// Exercise the production shared upcoming-event loader without real accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const rest = source.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const now = Date.parse('2026-10-25T01:46:00Z');
const events = [
  { id: 'saudi', item_type: 'event', title: 'Saudi 2026', due_at: '2026-11-03T09:00:00Z', end_at: '2026-11-06T09:00:00Z', completed: false, uci_schedule_status: 'cancelled' },
  { id: 'future', item_type: 'event', title: 'Future Cup', due_at: '2099-11-23T09:00:00Z', uci_schedule_status: 'confirmed' },
  { id: 'tbc', item_type: 'event', title: 'Location pending', uci_schedule_status: 'provisional' },
  { id: 'completed', item_type: 'event', title: 'Completed Cup', completed: true, due_at: '2099-12-01T00:00:00Z' },
  { id: 'past', item_type: 'event', title: 'Previous Cup', due_at: '2020-01-01T00:00:00Z' },
];
const before = JSON.stringify(events);
const calls = [];
const client = {
  from(table) {
    const query = {
      select(columns) { calls.push({ table, columns }); return query; },
      eq() { return query; },
      order() { return query; },
      in(column, ids) { calls.push({ table, column, ids: [...ids] }); return query; },
      then(resolve, reject) { return Promise.resolve({ data: table === 'dashboard_items' ? events : [{ event_id: 'future' }], error: null }).then(resolve, reject); },
    };
    return query;
  },
  async rpc(name, args) {
    calls.push({ name, eventIds: [...args.p_event_ids] });
    return { data: [{ event_id: 'future', athlete_id: 'rider', display_name: 'Rider' }], error: null };
  },
};
const context = vm.createContext({ client });
vm.runInContext(['contestEventEndsAt', 'contestEventIsUpcoming', 'getSharedUpcomingEventData', 'combinedCoachCalendarItems'].map(extract).join('\n'), context);
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, label); checks++; };
(async () => {
  eq(context.contestEventIsUpcoming(events[0], now), false, 'Cancellation overrides future dates');
  eq(context.contestEventIsUpcoming({ uci_schedule_status: 'cancelled' }, now), false, 'Undated cancellation is hidden too');
  eq(context.contestEventIsUpcoming(events[1], now), true, 'Confirmed upcoming event remains visible');
  eq(context.contestEventIsUpcoming(events[2], now), true, 'Provisional event remains visible');
  eq(context.contestEventIsUpcoming(events[3], now), false, 'Completed event stays out of upcoming');
  eq(context.contestEventIsUpcoming(events[4], now), false, 'Past event stays out of upcoming');
  eq(context.contestEventIsUpcoming({ due_at: '2026-10-25T00:00:00Z', end_at: '2026-10-25T00:00:00Z', uci_schedule_date_only: true }, now), true, 'Date-only event lasts through its last day');
  const data = await context.getSharedUpcomingEventData();
  eq(data.events.map(event => event.id), ['future', 'tbc'], 'Shared coach/rider/parent event feed omits cancellation');
  eq(calls.find(call => call.name === 'get_active_event_attendees').eventIds, ['future', 'tbc'], 'No cancelled-event attendee fetch');
  eq(calls.find(call => call.table === 'event_course_photos' && call.ids).ids, ['future', 'tbc'], 'No cancelled-event course fetch');
  eq(data.events.find(event => event.id === 'future').course_photo_available, true, 'Remaining course and attendance metadata stays attached');
  eq(data.attendance[0].profile.display_name, 'Rider', 'Remaining rider attendance preserved');
  const calendar = context.combinedCoachCalendarItems({
    calendar: [{ id: 'lesson', starts_at: '2099-12-01T10:00:00Z', title: 'Coach lesson' }],
    dashboardItems: [...events, { id: 'task', item_type: 'task', title: 'Bike check', due_at: '2099-12-01T09:00:00Z' }],
  });
  eq(calendar.map(event => event.id), ['past', 'future', 'completed', 'task', 'lesson'], 'Coach calendar hides cancelled contests while retaining noncancelled history and tasks');
  eq(JSON.stringify(events), before, 'Filtering never removes or mutates historical source records');
  eq(fs.readFileSync(path.join(root, 'riley-test/app.js'), 'utf8'), source, 'Production and Riley app copies match');
  console.log(`PASS: ${checks} cancelled-event visibility checks.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
