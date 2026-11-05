# JKCREW 2.14.191 — Paid session costs

Session Tracker now records Paid separately from Expected invoice and Already
invoiced. Billing status applies to all riders selected in a record; use a
separate group when some riders have paid and others have not. Invoice dates
remain optional and are selected manually.

Parent Home excludes paid costs from expected invoices and shows them in their
own Paid dropdown. Entry fees covered by the coach retain their gross total;
payment received does not rewrite that record of the original cover. Unknown
additional-session prices cannot be marked Paid; confirmed zero prices can.
This feature records a coach's confirmation and does not collect payments or
send invoices.

The additive status migration preserves all rows/defaults and existing RPC
signatures. The narrow parent projection and all family permissions remain
unchanged. No private import data is included in this release.

Verification: 347 isolated SQL checks, 292 coach tracker browser checks, 92
parent cost browser/integration checks, 129 adapter checks, syntax, release
smoke and root/Riley asset parity. Mobile light/dark layouts were inspected.
The production schema update retained the same eight existing rows and digest.
Physical installed-device testing remains separate.
