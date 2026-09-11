# JKCREW Bike Garage — 2.14.98

A cosmetic BMX customiser built into JKCREW. Riders open **Profile → Build your dream bike**; coaches open **More → Bike Garage**. It uses original generated studio photographs with masked material recolouring, instant part/colour changes and a full-bike preview.

New bikes start as an all-white BMX with a clean frame and no pegs. The **Blank bike** button above the preview starts a fresh design, asking before replacing unsaved work. Existing saved colours and drafts are retained. Photographic artwork depicts the bike at a slight angle on a light studio background. Paint colours retain photographed material textures, shading and reflections.

Sixteen colour zones cover the frame, forks, bars, grips, rims, hubs, spokes, nipples, saddle, seat post, stem, headset, pedals, cranks, sprocket and pegs. Metal components offer gloss, matte, chrome, raw and jet-fuel finishes. Frames support a two-colour fade. Riders can choose plastic or metal platform pedals, top/front-load stems, rear or front-and-rear brakes, up to four pegs, rainbow titanium spoke styling, two/four-piece bars, tyre walls and seat shape. A paged gallery offers 50 original seat patterns alongside standard solid colours. Undo/redo restores design changes; Surprise me tries another colour combination. Bike names are limited to 40 characters.

Each account has three private saved slots. Explicit saving keeps designs across devices; a separate account-scoped local draft preserves ongoing edits on the current device where browser storage is available. Failed requests never show a successful save. Opening another design or starting over asks before replacing unsaved work. A revision conflict requires refreshing the garage and opening the latest design or saving into a free slot.

If a save succeeds remotely but its reply is lost, refreshing recovers that exact saved build without duplicating it or discarding newer local edits. Requests have bounded timeouts, and refreshing cannot race an in-progress save. A memory draft remains available during the current visit when browser storage is blocked.

A closed inspiration section links to 13 verified real seat and component references from Albe’s, Dan’s Comp and LUXBMX. The garage remains a visual customiser; its original looks do not imply exact branded parts, fit or availability. There is no checkout. It has no points, XP, reward, training or invitation write paths. The existing share-card feature remains disabled.

## Integration

- `bike-config.js`: shared version-2 defaults and strict normalization; old local fingerprints and pending-save recovery are normalized without overwriting saved records.
- `bike-seat-designs.js`: 50 original patterns and verified source links.
- `bike-renderer.js`: sanitised photographic SVG compositor, bounded public-image loading and keyboard-accessible part controls.
- `bike-photo-masks.js`: material masks and alternate-part silhouettes in the photographs’ fixed 1536 × 1024 coordinates.
- `images/bike-garage/studio-white-v1.webp` and `studio-options-v1.webp`: original photographic assets, about 109 KB each. Photos load only on demand, then use the public-asset service-worker cache. They do not block sign-in or worker installation. Original PNG sources are retained beside them.
- [Generation prompts and provenance](bike-garage-artwork.md).
- `bike-garage.js` / `bike-garage.css`: scoped UI, draft state, explicit save/remove and lifecycle cleanup.
- `get_bike_garage`, `save_bike_build`, `delete_bike_build`: authenticated security-invoker RPCs, protected by ownership RLS and strict configuration validation.
- `supabase/migrations/20260911102828_add_private_bike_garage.sql`: additive schema. Removed slots keep a revision tombstone with no bike name/configuration, so a stale device cannot overwrite a later replacement.
- `supabase/migrations/20260911111023_allow_solid_white_bike_tyres.sql`: permits the new solid white tyre choice without changing saved builds, revisions or access permissions.
- `supabase/migrations/20260911122927_support_bike_garage_parts_v2.sql`: accepts strict v2 configurations alongside unchanged legacy v1 configurations. Existing rows, ownership and revision protection are retained.
- `studio-hardware-v2.webp` and `studio-metal-v2.webp` supply aligned platform pedals, stem variants, pegs and brake hardware. All public bike photos load only on demand and are cached independently of private garage data.
- Six `studio-*-v3.webp` material photographs add tube-following chrome and jet-fuel reflections, including four-piece bars and both stem shapes. Raw metal remains more diffuse than chrome; paint, rubber and all 50 seat patterns use the original photographed surface shading. Each material asset loads only when required.
- Client modules and delivery assets are included in both app paths and their separate service-worker caches.

## Validation

`tests/bike-garage-db.cjs` covers CRUD, configuration validation, actual authenticated/anonymous roles, owner isolation, protected columns, revision conflicts and delete/recreate behaviour. Additional isolated PostgreSQL tests exercised five overlapping real-connection races: create, edit, remove-before-save, recreate and save-before-remove. Existing profiles and scoring tables are unchanged.

`tests/bike-garage-ui.cjs` exercises the real UI and artwork with isolated save fixtures, mobile/tablet layouts, drafts, saved designs, failure/conflict handling and account/navigation cleanup. Existing smoke, closed-section and startup/cache checks cover the app integration.

Design reference: the user's [Source BMX custom builder](https://us.sourcebmx.com/en-au/products/custom-builder-bike). The JKCREW feature uses original code and artwork, with no Source product images or storefront embedded.
