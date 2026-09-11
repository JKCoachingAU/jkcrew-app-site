# Today's Progress and share-preview hooks

`progress-sharing.js` and `progress-sharing.css` are review-copy assets. Load CSS after `styles.css`, and the deferred JavaScript before `app.js`. Add both to the existing service-worker asset list with the same version convention as the app.

The module reads the current global `state` and `client` only when an action runs. It calls `get_today_training_progress({p_athlete_id})` using the contract in `daily-progress-api.md`. The backend selects the rider's local day and authorizes access. The UI does not calculate day boundaries, count weekly totals as daily earnings, or use an overall session timer.

## Integration

- Render `trainingProgressButtonHtml(athleteId, riderName)` on the rider's own Session screen. A coach may use the same hook on each rider's Session Viewer card. Other rider accounts and parents do not receive the button.
- Call `bindTrainingProgressActions(root)` after rendering. Repeated binding is safe.
- After a successful recorded activity or realtime activity refresh, call `void refreshOpenTrainingProgress(athleteId)`. It does nothing unless that rider's summary is open and reads fresh data. Calls for another rider do nothing. Opening the summary and returning to the tab also read fresh data.
- From the saved Daily result's **Share result** click handler, call `showTrainingSharePreview({dailyResult: persistedResult})` with the authoritative `confirm_daily_finish` response. It must contain `athlete_id`, `rider_name`, `local_date`, `seconds`, `completion_points`, `pb_comparable`, PB fields and clearly labelled `weekly_score`/`rank_number` where available.
- Call `closeTrainingProgressViews()` during account reset/signout. These native dialogs are appended to `body`, separately from the application shell.

The summary's **Share / Save Image** button opens a preview; no external share happens on opening. The preview creates a PNG and File before the final button click so native file sharing retains Safari's user activation. Native sharing is used only when `navigator.canShare({files})` reports support; otherwise the same button downloads the PNG. **Save Image** always downloads. Cancellation keeps the preview open; other native errors offer Save Image. Actual placement in Photos versus Files depends on the browser/share sheet.

## Privacy and correctness

`buildTrainingShareData` explicitly allowlists fields. The exported image uses rider name, local date, recorded result/rewards, compatible PB information, and completed category/trick names. No profile spread, avatar fetch, contact data, private coaching feedback or run-plan data is passed to the canvas. The preview states what the image includes. Shared Line names come strictly from `trick_name`; freeform notes are never used to reconstruct an exported Line. The private summary can use the existing app parser to display legacy Lines stored across title and notes.

Only `pb_comparable:true` permits PB labels or comparison. Older saved results retain their recorded time but show unavailable rewards as `—`, not zero. Today's Progress uses persisted local-day reward totals and shows the weekly total separately. A partial XP attribution renders `—` with a private explanation; its known subtotal is not presented or exported as a complete daily total. The share card has a fixed portrait size, 1080 × 1440; longer completion lists show a balanced selection across categories and an explicit remaining count, while the private summary lists every returned completion.

Requests are guarded by account, current modal and request sequence. Failed refreshes retain the prior summary with a retry message and disable sharing until fresh data loads. The module never writes training data or changes a rider/team timer.

## Isolated verification

Run `tests/progress-sharing.cjs` with the same `JKCREW_PLAYWRIGHT_PATH` and `JKCREW_BROWSER_PATH` variables as the existing browser tests. Network requests are blocked and all records/RPCs are mocked. PNG downloads are test artifacts only. Screenshots default to `/tmp`, configurable with `JKCREW_SCREENSHOT_DIR`.
