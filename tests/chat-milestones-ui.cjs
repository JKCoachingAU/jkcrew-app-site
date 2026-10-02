// Exercise the real chat queries/renderers with synthetic data and no live requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Actual function exists: ' + name);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const declaration = name => {
  const line = app.split('\n').find(line => line.startsWith('const ' + name + ' = '));
  assert(line, 'Actual constant exists: ' + name);
  return line;
};
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  let checks = 0;
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url() === 'http://jkcrew.test/'
      ? route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width, initial-scale=1"><main id="view"></main><nav><button class="nav-btn" data-view="board">Board</button></nav>' })
      : route.abort());
    await page.goto('http://jkcrew.test/');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.evaluate(() => {
      window.state = { user: { id: 'rider' }, profile: { role: 'athlete', display_name: 'Test Rider' }, view: 'home', session: { access_token: 'synthetic' } };
      window.qaRows = []; window.qaQueries = []; window.qaHandlers = []; window.qaFeed = [];
      window.qaInserts = []; window.qaRenderCount = 0; window.qaNotices = []; window.qaError = false;
      // A small PostgREST simulation applies operations in call order. In particular,
      // filtering after limit would incorrectly lose all seven visible messages.
      window.client = {
        from: table => {
          let rows = table === 'crew_posts' ? structuredClone(qaRows) : [];
          let head = false;
          const calls = { table, operations: [] }; qaQueries.push(calls);
          const query = {
            select: (value, options) => { calls.operations.push(['select', value]); head = options?.head; return query; },
            in: (key, values) => { calls.operations.push(['in', key, values]); rows = rows.filter(row => values.includes(row[key])); return query; },
            or: expression => {
              calls.operations.push(['or', expression]);
              const match = expression.match(/^metadata->>event_type\.is\.null,metadata->>event_type\.in\.\(([^)]+)\)$/);
              if (!match) throw Error('Invalid event filter: ' + expression);
              rows = rows.filter(row => row.metadata?.event_type == null || match[1].split(',').includes(row.metadata.event_type));
              return query;
            },
            gt: (key, value) => { calls.operations.push(['gt', key, value]); rows = rows.filter(row => row[key] > value); return query; },
            order: key => { calls.operations.push(['order', key]); rows.sort((a, b) => String(b[key]).localeCompare(String(a[key]))); return query; },
            limit: n => { calls.operations.push(['limit', n]); rows = rows.slice(0, n); return query; },
            insert: async row => { qaInserts.push(structuredClone(row)); return { error: null }; },
            then: (resolve, reject) => Promise.resolve(qaError ? { data: null, error: { message: 'Synthetic offline failure' } } : { data: head ? null : rows, count: rows.length, error: null }).then(resolve, reject),
          };
          return query;
        },
        rpc: async name => { if (name !== 'get_crew_feed') throw Error('Unexpected RPC'); return { data: qaFeed, error: null }; },
        storage: { from: () => ({ createSignedUrl: async path => ({ data: { signedUrl: 'http://jkcrew.test/media/' + path } }) }) },
        realtime: { setAuth: () => {} },
        channel: () => { const channel = { on: (_event, filter, handler) => { qaHandlers.push({ filter, handler }); return channel; }, subscribe: () => {} }; return channel; },
      };
      window.weekStartDate = () => '2026-09-27';
      window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      window.avatarHtml = () => '<span class="avatar"></span>';
      window.dateLabel = value => value;
      window.isCoachRole = role => ['coach', 'admin'].includes(role);
      window.formatBoardMessageBody = value => escapeHtml(value);
      window.renderBoard = async () => { qaRenderCount++; };
      window.getLeaderboard = async () => [];
      window.notify = value => qaNotices.push(value);
      window.canPostBoardChat = () => true;
      window.containsGifUrl = () => false;
      window.extractBoardMentions = () => [];
      window.riderFeaturesDisabled = window.riderFeatureAccessUnknown = () => false;
      window.realtimeVisibleAthleteIds = async () => ['rider'];
      window.setupLiveRunDiscovery = () => {};
    });
    await page.addScriptTag({ content: [
      ...['CREW_CHAT_MILESTONE_EVENTS', 'CHAT_LAST_SEEN_KEY', 'CHAT_MEDIA_BUCKET', 'CHAT_MEDIA_MAX_BYTES', 'boardReactionEmojis'].map(declaration),
      ...['crewChatEventFilter', 'isVisibleCrewChatPost', 'getBoardChat', 'getCrewFeed', 'refreshBoardChatUnread', 'updateBoardChatNavBadge', 'setupRealtimeSync', 'realtimeFilter', 'boardChatMessageHtml', 'renderAthleteCrew', 'submitCrewPost', 'submitBoardChat'].map(extract),
    ].join('\n') });
    const allowed = ['rank_one', 'leaderboard_overtake', 'challenge_complete', 'battle_result'];
    for (const event_type of allowed) eq(await page.evaluate(event_type => isVisibleCrewChatPost({ post_type: 'announcement', metadata: { event_type } }), event_type), true, event_type + ' remains visible');
    for (const event_type of ['new_trick', 'park_king', 'unknown_auto_event']) eq(await page.evaluate(event_type => isVisibleCrewChatPost({ post_type: 'announcement', metadata: { event_type, pinned: true } }), event_type), false, event_type + ' hidden even when pinned');
    for (const post of [{ post_type: 'chat' }, { post_type: 'announcement', metadata: {} }, { post_type: 'chat', metadata: { event_type: null } }]) eq(await page.evaluate(post => isVisibleCrewChatPost(post), post), true, 'Manual chat and coach announcements remain visible');
    eq(await page.evaluate(() => isVisibleCrewChatPost({ post_type: 'landed' })), false, 'Legacy raw trick activity is hidden');
    await page.evaluate(allowed => {
      qaRows = [
        ...Array.from({ length: 80 }, (_, index) => ({ id: 'noise-' + index, post_type: 'announcement', body: 'Landed trick ' + index, created_at: '2026-10-03T12:00:00Z', metadata: { event_type: index % 2 ? 'new_trick' : 'park_king' } })),
        ...allowed.map(event_type => ({ id: event_type, post_type: 'announcement', body: event_type, created_at: '2026-10-02T12:00:00Z', metadata: { event_type } })),
        { id: 'human', post_type: 'chat', body: 'See you at the park!', created_at: '2026-10-02T12:00:00Z', metadata: {} },
        { id: 'coach', post_type: 'announcement', body: 'Session starts at four', created_at: '2026-10-02T12:00:00Z', metadata: {} },
        { id: 'clip', post_type: 'chat', body: '', created_at: '2026-10-02T12:00:00Z', metadata: { media_path: 'rider/clip.mp4' } },
      ];
    }, allowed);
    const posts = await page.evaluate(() => getBoardChat());
    eq(posts.map(post => post.id), [...allowed, 'human', 'coach', 'clip'], 'Filtering before pagination keeps meaningful messages behind 80 muted events');
    eq(posts.at(-1).metadata.media_url, 'http://jkcrew.test/media/rider/clip.mp4', 'Manual riding clips retain signed media');
    eq(await page.evaluate(() => qaQueries[0].operations.map(([op]) => op)), ['select', 'in', 'or', 'order', 'limit'], 'Server event filter precedes message limit');
    await page.evaluate(() => refreshBoardChatUnread());
    eq(await page.locator('.board-chat-nav-badge').textContent(), '7', 'Unread badge counts only visible messages');
    eq(await page.evaluate(() => qaQueries.filter(q => q.table === 'crew_posts').map(q => q.operations.find(([op]) => op === 'or')?.[1])), Array(2).fill('metadata->>event_type.is.null,metadata->>event_type.in.(rank_one,leaderboard_overtake,challenge_complete,battle_result)'), 'Message and unread queries share the exact event policy');
    await page.evaluate(() => { qaError = true; return refreshBoardChatUnread(); });
    eq(await page.locator('.board-chat-nav-badge').textContent(), '7', 'A failed unread refresh preserves the last confirmed count');
    eq(await page.evaluate(async () => { try { await getBoardChat(); return ''; } catch (error) { return error.message; } }), 'Synthetic offline failure', 'A failed message read reports its failure');
    await page.evaluate(() => { qaError = false; qaRows = qaRows.filter(row => row.id.startsWith('noise-')); return refreshBoardChatUnread(); });
    eq(await page.locator('.board-chat-nav-badge').count(), 0, 'Only suppressed events produce no unread badge');
    await page.evaluate(() => setupRealtimeSync());
    for (const event_type of ['new_trick', 'park_king', 'unknown_auto_event']) {
      eq(await page.evaluate(event_type => { const before = qaQueries.length; qaHandlers.find(h => h.filter.table === 'crew_posts').handler({ new: { post_type: 'announcement', metadata: { event_type } } }); return qaQueries.length - before; }, event_type), 0, event_type + ' realtime event performs no unread request');
    }
    await page.evaluate(() => { state.view = 'board'; document.querySelector('#view').innerHTML = '<textarea id="board-message">My unsent draft</textarea>'; });
    for (const event_type of ['new_trick', 'park_king']) await page.evaluate(event_type => qaHandlers.find(h => h.filter.table === 'crew_posts').handler({ new: { post_type: 'announcement', metadata: { event_type } } }), event_type);
    eq(await page.evaluate(() => qaRenderCount), 0, 'Muted realtime events do not rebuild the open board');
    eq(await page.locator('#board-message').inputValue(), 'My unsent draft', 'Muted realtime events preserve a chat draft');
    for (const event_type of allowed) await page.evaluate(event_type => qaHandlers.find(h => h.filter.table === 'crew_posts').handler({ new: { post_type: 'announcement', metadata: { event_type } } }), event_type);
    await page.evaluate(() => qaHandlers.find(h => h.filter.table === 'crew_posts').handler({ new: { post_type: 'chat', body: 'Hello', metadata: {} } }));
    eq(await page.evaluate(() => qaRenderCount), 5, 'All four milestones and manual chat still refresh in realtime');
    await page.evaluate(() => {
      qaFeed = [{ feed_type: 'landed', body: 'Must stay hidden' }, { feed_type: 'announcement', body: 'Muted event', metadata: { event_type: 'new_trick' } }, { feed_type: 'chat', body: 'Manual message' }, { feed_type: 'announcement', body: 'Challenge complete', metadata: { event_type: 'challenge_complete' } }];
    });
    eq((await page.evaluate(() => getCrewFeed())).map(post => post.body), ['Manual message', 'Challenge complete'], 'Legacy crew RPC response cannot reintroduce per-trick activity');
    await page.evaluate(() => renderAthleteCrew());
    eq(await page.locator('#crew-chat-list .feed-card').count(), 2, 'Legacy crew screen displays only permitted messages');
    eq(await page.locator('.page-head p').textContent(), 'Chat with the crew and catch leaderboard overtakes, new leaders, completed weekly challenges and battle results.', 'Legacy crew copy explains the four automatic milestones');
    await page.evaluate(() => { document.querySelector('#view').innerHTML = '<form id="test-compose"><textarea name="body">Manual new trick message!</textarea><input name="tag" value="Training"><button type="submit" data-send-board-chat>Send</button></form>'; return submitBoardChat({ preventDefault() {}, currentTarget: document.querySelector('#test-compose') }); });
    const submitted = await page.evaluate(() => qaInserts.at(-1));
    eq(submitted.post_type, 'chat', 'Rider messages still use the normal chat notification path');
    eq(submitted.body, 'Manual new trick message!', 'A rider may still choose to share their own landing');
    eq(submitted.metadata.event_type, undefined, 'Manual messages are never tagged as suppressed automatic events');
    eq(await page.evaluate(post => isVisibleCrewChatPost(post), submitted), true, 'A newly submitted message passes the policy');
    eq(errors, [], 'Real chat functions run without browser errors');
    console.log('PASS: ' + checks + ' chat milestone visibility, server pagination, unread, realtime, legacy feed and manual-message checks.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
