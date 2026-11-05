# JKCREW 2.14.190 — Parent session costs and invoice expectations

Parent Home now includes a Sessions & fees card for the selected linked child.
It shows completed additional sessions, planned additional sessions, recorded
park entry fees paid by the coach, and expected extra-session/entry costs.
Expandable invoice-date groups show each park, session, individual fee and
whether it is planned, completed, coach-paid or already invoiced.

Coach Tools → Session Tracker → Edit session includes a compact Parent costs /
Invoice details section. Extra-session shortcuts select Additional; coaches can
enter the additional coaching fee per rider, confirm completion and park entry
payment, choose an invoice date, and mark the session already invoiced.
Invoice dates are always chosen manually for each session, as requested. Blank
dates and unknown extra-session prices stay to be confirmed; an explicit zero
price means free. Changing a block or session date preserves the chosen invoice.

The parent total covers extras and park entry only, not regular lesson fees or
a complete invoice balance. Planned fees are estimates. This feature does not
send invoices, collect payments, mark parent payments received or infer prior
attendance/payment. Statuses apply to the riders selected in the saved session.

The database stores integer cents and explicit statuses. Original V1/V2 save
APIs remain unchanged and preserve newer fields. Version checks, stable UUIDs,
duplicate-tap guards and retained drafts protect retries and conflicting saves.
Existing archive/Undo and installed-update draft protections remain intact.

Parents read a minimal child-only projection through a protected RPC. Current
parent, athlete and owning-coach roles and both linking tables are checked on
every page. Raw coach session/block tables remain coach-only. Shared legacy park
fees divide in integer cents, including remainders, without exposing other rider
IDs, names, quantities or the full-session total. All pages must share the same
snapshot before the UI displays totals. Failed/inconsistent reads show a retry
message rather than a partial or false zero total. No costs are stored locally
and the card does not poll in the background.

Verification:

- 308 isolated SQL checks: 110 new parent-cost checks, 97 block checks and 101
  original tracker checks, with the extension applied.
- 279 coach tracker browser checks, including all 206 previous checks.
- 127 real adapter checks for cost validation, defaults, payloads and account guards.
- 78 parent card/browser integration checks for totals, TBC prices, pagination,
  snapshot changes, retry, child/account/navigation changes, escaping and layout.
- 207 parent Home leaderboard checks, 91 parent battle checks and 69 parent
  Road to LA28 integration checks. Two legacy test harnesses were updated to
  provide the existing Session Tracker route stub.
- Dark/light layouts at 320, 390 and 1024px were tested and screenshots inspected.
- Release smoke, JavaScript syntax, asset parity, service-worker startup/update
  and coach startup checks passed.

The additive production migration was applied and verified. All seven existing
sessions and the existing block retained their original field values and
timestamps. New fields default to regular, not confirmed complete, no confirmed
coach payment, unknown extra price/date and not yet invoiced. Database security
and performance advisor counts remain unchanged from the pre-release baseline.

Browser and database regression tests use synthetic families and transport;
no production test sessions were created. Physical iPhone/Android keyboard and
installed-device testing remain outstanding.
