# JKCREW 2.14.159 — Elite Riders group

The coach Riders page now includes an Elite Riders list using the existing
green accent and group-card design. Coaches can add riders by dragging their
cards or selecting Elite Riders under Training groups in a rider's profile.
Other memberships remain available. No riders are assigned automatically.

The existing group selector also exposes Elite Riders in Session Viewer, so
coaches can view their lists and start a group session. Group changes now clear
the separate Session Viewer roster cache immediately, avoiding the previous
30-second stale-membership window after adding, removing or editing groups.

The live database already accepts elite memberships and sessions. Read-only
checks confirmed compatibility with the existing calendar, attendance and
weekly-challenge group fields. No migration, permission or scoring change is
required. Broadcast audiences remain unchanged.

Verification:
- Focused browser checks using actual app functions and synthetic data:
  empty/populated Elite list, profile checkbox, adding and removing memberships
  while preserving other selected groups, and Session Viewer cache invalidation
  after all three membership update paths.
- Elite Session Viewer filtering and group/location controls at 390 and 1024px.
- Visually checked desktop and mobile Elite cards; no horizontal page overflow,
  browser errors or production data writes in these checks.
- Existing session-viewer setup and rider-feature-access browser checks pass,
  including 320/390/1024/1440px layouts and dark/light controls.
- All 50 service-worker startup/update checks, release smoke, JavaScript syntax,
  whitespace and root/Riley mirror checks pass.

Root and Riley assets use version 2.14.159 with separate service-worker cache
namespaces. This release is based on live 2.14.157 and intentionally does not
publish the separate recovery-mode draft, whose backend deployment is pending.
