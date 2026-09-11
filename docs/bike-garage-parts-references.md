# Bike Garage parts and seat artwork

Research checked 11 September 2026 against the named shops’ product pages. The 50 seat designs in `bike-seat-designs.js` are **original JKCrew custom looks**, not 50 real products, brand collaborations or exact reproductions. They use locally generated SVG patterns. Product names appear only as clearly labelled references; no retailer images, logos, prices or live inventory are imported.

## Verified references

| Part / idea | Real product and source | What the reference supports |
| --- | --- | --- |
| Tie-dye seat | [Odyssey Aaron Ross Tie-Dye Pivotal Seat — Albe’s BMX](https://www.albes.com/products/odyssey-aaron-ross-tie-dye-pivotal-seat) | A real tie-dye seat. The garage’s six spiral colourways are newly drawn artwork. |
| Leopard seat | [Bone Deth Vibrator Pivotal Seat — LUXBMX](https://www.luxbmx.com/products/bone-deth-vibrator-pivotal-seat) | Leopard print on a mid-padded pivotal seat; the original JKCrew leopard pattern copies no product graphic. |
| Zebra seat | [Fiend Reynolds V2 Pivotal Seat (Zebra) — Dan’s Comp](https://www.danscomp.com/fiend-reynolds-v2-pivotal-seat-zebra-st-402zbr/p1557946) | A printed canvas zebra seat. |
| Floral fabric | [Odyssey X Bloom BMX Pivotal Seat (Cream Corduroy/Flowers) — Dan’s Comp](https://www.danscomp.com/odyssey-x-bloom-bmx-pivotal-seat-v2-cream-corduroy-flowers-slim-ods-417-bloom2/p1629907) | A real floral corduroy cover; the garage flowers have their own shapes and palettes. |
| Camo seat | [Federal Bikes Slim Logo Pivotal Seat (Camo/Black) — Dan’s Comp](https://www.danscomp.com/federal-bikes-slim-logo-pivotal-seat-camo-black-12-fe306v/p1308873) | An archived camouflage seat example. The page marks it discontinued; it is a design reference, not a current shopping suggestion. |
| Plastic pedals with moulded pins | [Odyssey Twisted Pro PC Pedals (Black/Purple Swirl) — Dan’s Comp](https://www.danscomp.com/odyssey-twisted-pro-pc-pedals-black-purple-swirl-pair-odp-109-bkpur-p/p1429032) | Plastic composite platform, moulded grip pins and a swirl finish. |
| Plastic pedals with metal pins | [MCS Sealed Pedals — LUXBMX](https://www.luxbmx.com/products/mcs-sealed-pedals) | Nylon composite body with replaceable screw pins. Body material and pin material are separate choices in real parts. |
| Metal pinned pedals | [HT AE05 Pedals — LUXBMX](https://www.luxbmx.com/products/ht-ae05-pedals-alloy-cnc-crmo) | CNC aluminium body and replaceable grip pins. |
| Front-load stem | [Odyssey CFL3 Stem — Albe’s BMX](https://www.albes.com/products/odyssey-cfl3-stem) | A real front-load clamp shape with machined aluminium body. |
| Top-load stem | [Salt Pro V2 Top Load Stem — LUXBMX](https://www.luxbmx.com/products/salt-pro-v2-top-load-stem) | A top clamp plate; listed colours include Chrome and Oil Slick. |
| Rainbow titanium spokes | [USA Brand Titanium Spoke for 16-inch Wheels (Rainbow) — Albe’s BMX](https://www.albes.com/products/usa-brand-titanium-spoke-for-16-wheels-rainbow) | Real rainbow titanium spokes. **This particular listing is for 16-inch wheels.** It is a finish reference and makes no compatibility claim for the illustrated bike. |
| Anodised and machined finishes | [S&M Enduro V2 Stem — LUXBMX](https://www.luxbmx.com/products/s-m-enduro-v2-stem) | Examples of coloured metal and visible machined surfaces. |
| Reflective finishes | [Arise Xenon Expert Pedals — LUXBMX](https://www.luxbmx.com/products/arise-xenon-expert-pedals) | Listed High Polished Silver and Oil Slick variants. These are visual references; the garage renders an approximation. |

References are informative links, with no endorsement or fit assessment. A rendered finish is not a claim about a real part’s construction, durability or performance. Exact thread, clamp and spoke dimensions remain product-specific. The runtime `references` array carries the same labels and source URLs without loading external imagery.

## Original seat catalogue

Stable IDs are `design-01` through `design-50`. `solid` remains the renderer’s normal seat-colour mode and is not counted as a patterned design.

| Category | IDs | Original looks |
| --- | --- | --- |
| Wild | 01–08 | Leopard; Snow leopard; Neon leopard; Zebra; Electric zebra; Tiger stripes; Cow spots; Emerald scales |
| Tie dye | 09–14 | Rainbow tie dye; Sunset tie dye; Ocean tie dye; Acid tie dye; Berry tie dye; Pastel tie dye |
| Graphic | 15–22 | Race checker; Lilac checker; Warped checker; Lightning club; Hazard stripe; Contour map; Pixel arcade; Retro grid |
| Nature | 23–28 | Daisy chain; Midnight bloom; Tropical palms; Cherry blossom; Fern forest; Sunflower |
| Camo | 29–33 | Woodland camo; Arctic camo; Desert camo; Neon camo; Digital camo |
| Cosmic | 34–38 | Deep galaxy; Pink nebula; Constellation; Northern lights; Meteor shower |
| Flow | 39–44 | Ocean waves; Heat waves; Marble cloud; Lava flow; Liquid silver; Neon squiggle |
| Texture | 45–50 | Carbon weave; Diamond quilt; Coffee corduroy; Indigo denim; Terrazzo; Confetti club |

## Module contract

Load `bike-seat-designs.js` before the bike renderer. It exposes the frozen `globalThis.JKCrewBikeSeats` object:

- `designs`: 50 frozen `{id, name, category}` records. Selected designs have optional `sourceTitle` / `sourceUrl` links to the verified family reference. Those fields never change the design into a real product.
- `references`: frozen `{part, title, shop, url, description}` records. `part` is `seat`, `pedals`, `stem`, `spokes` or `finish`.
- `defs(idPrefix, designId)`: SVG pattern/gradient definitions, without an outer `<defs>` element. Include these inside the renderer’s existing `<defs>`.
- `fill(idPrefix, designId)`: `url(#...)` for that pattern. Use the same prefix as `defs` and apply the result through the actual saddle mask.
- `thumbnail(designId)`: self-contained decorative SVG markup, with unique per-call paint IDs. Insert it inside a separately named button; it carries `aria-hidden="true"` and is not itself interactive.

`defs`, `fill` and `thumbnail` return an empty string for `solid` or an unknown ID. IDs are checked against the catalogue; caller prefixes are reduced to bounded letters, digits, underscores and hyphens with a safe leading namespace. No user strings enter pattern path data, colours or embedded HTML. Pattern output is deterministic for the same prefix/design pair.

Patterns use the photo’s 1536 × 1024 coordinate space, with their tile origin at `(440, 300)`. Most tiles are 24–100 photo pixels wide, appropriate for the saddle’s approximately 218 × 90 photo-pixel bounds. Thumbnails use the same coordinates and density. The bike renderer should retain its photographic saddle shading over the pattern and preserve the original solid-colour path when `fill` is empty. The module itself has no network requests, timers, animation, account data or save side effects.

## Validation

The isolated browser contact-sheet check covers exactly 50 sequential IDs, deterministic definitions, safe invalid/prefix-injection handling, unique thumbnail IDs, resolved nested gradients/patterns and successful SVG rendering. The contact sheet is generated locally at `/tmp/jkcrew-seat-designs-contact-sheet.png`; it is not a production asset. Full garage/controller and photographic-mask integration are checked separately by the integration tests.
