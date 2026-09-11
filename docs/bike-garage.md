# JKCREW Bike Garage — 2.14.94

A cosmetic BMX customiser built into JKCREW. Riders open **Profile → Build your dream bike**; coaches open **More → Bike Garage**. It uses an original SVG illustration with instant part/colour changes and a full-bike preview.

Ten parts can be recoloured. Riders can also change two/four-piece bars, tyre walls, seat shape, pegs and the frame graphic. Undo/redo restores design changes; Surprise me tries another colour combination. Bike names are limited to 40 characters.

Each account has three private saved slots. Explicit saving keeps designs across devices; a separate account-scoped local draft preserves ongoing edits on the current device where browser storage is available. Failed requests never show a successful save. Opening another design or starting over asks before replacing unsaved work. A revision conflict requires refreshing the garage and opening the latest design or saving into a free slot.

If a save succeeds remotely but its reply is lost, refreshing recovers that exact saved build without duplicating it or discarding newer local edits. Requests have bounded timeouts, and refreshing cannot race an in-progress save. A memory draft remains available during the current visit when browser storage is blocked.

The garage is visual play, not a real component catalogue, compatibility calculator or checkout. It has no points, XP, reward, training or invitation write paths. The existing share-card feature remains disabled.

## Integration

- `bike-renderer.js`: pure, sanitised SVG renderer with keyboard-accessible part controls.
- `bike-garage.js` / `bike-garage.css`: scoped UI, draft state, explicit save/remove and lifecycle cleanup.
- `get_bike_garage`, `save_bike_build`, `delete_bike_build`: authenticated security-invoker RPCs, protected by ownership RLS and strict configuration validation.
- `supabase/migrations/20260911102828_add_private_bike_garage.sql`: additive schema. Removed slots keep a revision tombstone with no bike name/configuration, so a stale device cannot overwrite a later replacement.
- The three client assets are included in both app paths and their separate service-worker caches.

## Validation

`tests/bike-garage-db.cjs` covers CRUD, configuration validation, actual authenticated/anonymous roles, owner isolation, protected columns, revision conflicts and delete/recreate behaviour. Additional isolated PostgreSQL tests exercised five overlapping real-connection races: create, edit, remove-before-save, recreate and save-before-remove. Existing profiles and scoring tables are unchanged.

`tests/bike-garage-ui.cjs` exercises the real UI and artwork with isolated save fixtures, mobile/tablet layouts, drafts, saved designs, failure/conflict handling and account/navigation cleanup. Existing smoke, closed-section and startup/cache checks cover the app integration.

Design reference: the user's [Source BMX custom builder](https://us.sourcebmx.com/en-au/products/custom-builder-bike). The JKCREW feature uses original code and artwork, with no Source product images or storefront embedded.
