# JKCREW 2.14.171 — Calmer points ledger and published total

The Road to LA28 tracker now uses neutral charcoal panels, white point values,
blue links and quieter status labels. Teal remains on the main actions and title.
Repeated green event badges are replaced by compact inclusion labels, keeping
UCI counted/outside-best-results distinctions visible. Entry dialogs use the same
neutral surfaces and blue checklist accents.

The Points ledger shows Total UCI points beside Record result, including the
ranking publication date. It reads the exact linked rider from the existing
published ranking feed, never sums manual records or excluded event points.
Missing identities/data show a dash, a genuine published zero remains zero, and
retained/offline totals are identified as a saved snapshot. This reuses the
loaded feed and adds no requests, permissions or database changes.

Verification:
- 214 tracker UI checks: men/women identities, missing/ambiguous IDs, published
  zero, separate manual results, stale/error/retry states, rider switching while
  loading, no extra fetches, form saves/conflicts and source escaping.
- 30 existing app routing, role/access, draft and teardown checks.
- Dark/light layouts at 320, 390, 768 and 1440px, including the action/total row,
  44px controls and text contrast of at least 4.5:1 for tested text tokens.
- Additional actual rider-shell previews with brand fonts at 320/390px in both
  themes, plus the entry dialog; no horizontal overflow.
- Release smoke and 50 installed-app update lifecycle checks passed.

Root and Riley copies, manifest, cache version and asset references are aligned.
Physical iPhone/Safari appearance remains a real-device check.
