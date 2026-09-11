# Bike Garage photographic artwork

Created with the built-in image-generation tool on 11 September 2026 for JKCREW, using the app's previous original drawing as a geometry guide. No third-party product photos, brands or storefront assets are embedded.

Production assets:

- `images/bike-garage/studio-white-v1.webp` — neutral photographic base, 1536 × 1024, 109,116 bytes.
- `images/bike-garage/studio-options-v1.webp` — aligned alternate bars, padded saddle and pegs, 1536 × 1024, 108,320 bytes.
- Original generated PNG files are retained beside the WebP assets. WebP conversion only compresses the files; it does not change the design or dimensions.
- The two production WebP assets are mirrored in `riley-test/images/bike-garage/`.

The app composites photo regions for structural options and applies colour transfer only inside traced material masks. The neutral base, coloured versions, component boundaries, mobile view and fullscreen are visually checked. Existing saved configurations use the same schema and remain editable.

## Final base prompt

Use case: sketch-to-render. Project asset for an interactive BMX bicycle colour customiser. The supplied image is ONLY a geometry/composition guide: transform the illustrated white BMX into a genuinely photorealistic studio product photograph of a real professional freestyle BMX. It must look photographed with a full-frame camera and studio softboxes: real powder-coated steel tubing with weld beads and subtle uneven reflections, real stitched white saddle, white rubber grips with fine ribbed texture, white rubber tyres with crisp real tread, intricate real crossed spokes, correctly assembled hubs, chain links, machined white sprocket, realistic pedals and bolts. No cartoon, no drawn outlines, no illustration, no simplified 3D toy look. Keep the exact same slight drive-side viewing angle and bike silhouette/part arrangement from the guide: rear wheel left, front wheel right, rising straight top tube, low saddle, tall narrow bars viewed at a slight angle, cranks almost horizontal. ALL paintable bike parts are neutral white/light gray, including both tyres. White tyres must still clearly show rubber texture. Bare metal spokes/chain and tiny bolts can be subtle silver. No pegs, no decals or logos. Remove all page UI, title, close button and text. Deliver a single whole bike centred, generous clean margin, both tyres fully visible, white seamless studio floor/background with a gentle real contact shadow, soft natural contrast that shows contours clearly. Landscape 3:2 canvas, bike fills roughly 85% of width and 85% of height. This is a production photographic base asset that will be recoloured, so preserve neutral untinted lighting and sharp part boundaries. Do not add extra objects, text, logos or watermark.

## Final options prompt

Use case precise-object-edit, production asset variants for a bicycle customiser. The provided BMX studio photograph is the master. Create ONE edited photograph on EXACT SAME 1536x1024 canvas, pixel-aligned camera/framing/background/bike position: keep every wheel spoke, tyre, frame tube, chain, crank, fork, stem and all illumination unchanged. Only change THREE areas: (1) replace the tall two-piece handlebars with realistic tall four-piece BMX handlebars, retaining exactly same white grips, bar height and stem mount position; four-piece bars have straight upright welded tube segments rather than a rounded one-piece bend at the bottom. (2) slightly thicken the same white saddle into a padded BMX saddle, same mounting post and overall position. (3) add realistic clean satin-white cylindrical BMX axle pegs at BOTH visible front and rear wheel hubs, projecting to the viewer/right; each roughly 70px long, attached exactly to existing axle bolt, with visible hollow end and rounded rim. Keep image fully photorealistic, no drawing/vector/illustration, no text or logos. These edited regions will be used as aligned replacement patches over the original photo. Crucial: do not move the bike, wheel centers, camera, source light or background; no zoom, no crop, no added margin. Keep all unedited pixels and parts identical.

## Expanded hardware — 2.14.97

Two additional aligned photographs were created using the **built-in ImageGen tool**, not the CLI. They are generic original BMX components informed by the rider's examples and the shop references in [parts research](bike-garage-parts-references.md). Product brands and logos were not copied. Original PNGs and quality-92 WebP delivery files are retained under `images/bike-garage/`.

### `studio-hardware-v2.png` / `.webp`

Edit target: `studio-white-v1.png`. Final prompt:

> Use case: precise-object-edit. Asset type: aligned photographic part-variant layer for an interactive BMX customizer. Edit the provided 1536x1024 white BMX studio product photograph. Keep EXACT bike geometry, framing, viewpoint, light background, wheels, spokes, frame, bars, saddle, chains and every existing pixel position wherever possible. Change ONLY these realistic equipment details: 1) replace the small visible pedal at x780-870,y605-660 with a wider authentic BMX composite nylon platform pedal, white/light gray, rectangular cage with two large open windows, finely textured knurled surface and many small traction pins, thick molded edges, photographic product quality. Keep its spindle at same position and preserve crank position. 2) Replace the stem around x1034-1110,y264-305 with an authentic polished silver top-load BMX stem, clamp bolts on top, same handlebar and steerer connections. 3) Add functioning black rear AND front BMX U-brakes with small silver arms and realistic thin black cables going to brake levers by the handlebars. Brake arms adjacent to wheel rims, realistic mounting and cable routing. 4) Add four silver cylindrical axle pegs: one on each side of each wheel. Near-side pegs project toward camera slightly left from rear and front axles, far-side pegs visibly extend right from their axles behind the wheel. Preserve all other parts and geometry; no labels, no graphic overlays, no logos, no watermark. Must remain a real photo, never an illustration. White bicycle and light gray hardware except thin black brake cables.

### `studio-metal-v2.png` / `.webp`

Edit target: `studio-hardware-v2.png`. Final prompt:

> Use case: precise-object-edit. Asset type: second aligned photographic BMX hardware variant. Keep EXACT the provided 1536x1024 photograph, bike geometry, camera, lighting, white background, bars, frame, wheels, spokes, seat, brakes and cables, four pegs, crank spindle and every other pixel position. Only replace TWO parts: (1) the visible pedal at approximately x778-902,y600-677 must become an authentic high-end CNC machined ALUMINIUM BMX platform pedal, brushed polished silver, thin angular body, large open cutouts and fine black replaceable metal traction pins around perimeter. Distinctively a metal platform pedal, realistic reflections and machined chamfered edges; keep original pedal footprint and spindle position. (2) replace the silver stem at x1028-1118,y252-306 with an authentic BMX FRONT-LOAD stem; compact forged aluminium rectangular body with a distinct front face plate with four recessed bolts clamping bars. Same handlebar and fork connection locations, no geometry shifts. The two changes must look like actual photographic BMX equipment, never drawn. No logos, no text, no watermarks. Preserve every other component, shadow, crop and dimension.

The renderer selectively clips these photos into the common coordinate space. Brake cables and arms use sparse masks; finishes and original seat patterns are composited through the actual photographed surfaces. The 50 seat graphics are deterministic code-native patterns, not retailer image files or generated copies of branded graphics.

## Material and fabric graphics — 2.14.98

The built-in ImageGen tool created six sibling photographic material masters. Each uses the existing 1536 × 1024 coordinate space. Original generated PNGs are saved in `images/bike-garage/`; same-size quality-95 WebP delivery files are saved beside them and mirrored into `riley-test/images/bike-garage/`. The compositor clips these material photos to the matching component, preserving saved build geometry and colours. They are loaded only when the selected configuration needs them and remain outside the startup app-shell precache.

Chrome and jet-fuel reflections now follow the photographed tubes. Raw metal mixes diffuse surface detail with restrained reflections; painted parts and rubber use stronger photographic shading. The 50 existing seat IDs now use larger irregular native SVG patterns and a subtle weave, shaded by the actual saddle photo. No account, configuration-schema or saving changes are included in this graphics release.

### `studio-chrome-v3.png` / `.webp`

Edit target: `studio-white-v1.png`. Final prompt:

> Use case: precise-object-edit. Asset type: exact registered photographic metal reflection master for a BMX configurator. Input is the edit target, a 1536x1024 white BMX product photograph. LOCK camera, angle, image dimensions, crop, bicycle geometry, outlines, tube joints, component placement, wheels, spokes and every silhouette. Do not move a single component. Change only the material finish of the metal frame tubes, fork legs, handlebars, rims, hubs, sprocket and crank arms into flawless polished CHROME METAL. Real high-end catalog macro photography: deep charcoal reflections of studio flags, narrow crisp white softbox highlights, smoothly curved reflections wrapping around cylindrical tubing, clear bright metal edges and visible welded tube joins. These are smooth polished steel BMX tubes, not faceted or striped plastic. Strong realistic tonal contrast from charcoal to brilliant silver, not washed-out gray. Keep seat, grips, tyres and pedals white, keep chain and small hardware in original silver, preserve background and ground shadow perfectly. No labels, logos, graphics, colour tints, added parts or text. No changes in framing. The output must precisely align with the original for per-part compositing. Photoreal, physically plausible chrome reflections; no illustration, no comic rendering, no flat gradient illustration. Studio light stays soft but metal has high contrast natural reflections.

### `studio-chrome-options-v3.png` / `.webp`

Edit target: `studio-options-v1.png`. Final prompt:

> Use case: precise-object-edit. Asset type: aligned chrome handlebar material layer for interactive BMX bike. Edit this exact1536x1024 photograph. Change ONLY the four-piece handlebar's metal tubes into polished chrome steel, with deep charcoal studio flag reflections and narrow brilliant white softbox highlights wrapping naturally around the cylindrical tubes, preserving the existing shapes, thickness, all joints and exact grip positions. Keep grips white. Keep the entire bicycle, every other part, frame, fork, seat, wheels, pegs, background, camera, framing and pixel geometry otherwise unchanged. Photographic chrome, strong real metal reflection detail, no flat gradients, no extra parts, no logos or text. The entire image must align precisely with the supplied photograph so only the bar area can be composited in software.

### `studio-jetfuel-v3.png` / `.webp`

Edit target: `studio-chrome-v3.png`. Final prompt:

> Use case: precise-object-edit. Asset type: registered iridescent metal photograph for BMX customizer. Edit this exact 1536x1024 chrome BMX studio photograph. Lock exact bicycle geometry, camera, framing, silhouettes, part positions, joints, wheels and shadows. Change ONLY all chrome metal parts (frame tubes, forks, bars, rims, hubs, sprocket, cranks, seatpost, stem and headset) into polished PVD OIL SLICK / JET FUEL finish seen on real high-end BMX components: deep electric cyan-blue and violet-purple, hot magenta at curved edges, small rich golden-green shifts, reflective mirror metal with charcoal shadow stripes and sharp silver-white studio highlights. The hues must follow the physical curvature and angle of each individual tube, not a single rainbow gradient across the picture. Top tube mostly cyan-blue with violet edges, downtube mainly deep magenta/violet shifting into cyan on the facing surface, gold appearing naturally at reflective transitions and some rear stays. Strong saturated anodized iridescent metal, not pastel paint, not glitter. Keep the white saddle, grips, tyres and pedals exactly white, chain silver, original pale studio background completely unchanged. No frame logos, no text, no extra components, no reshaping. Highly realistic product photography, real metal reflections and smoothly blended thin-film colours around every cylindrical surface.

### `studio-chrome-top-stem-v3.png` / `.webp`

Edit target: `studio-hardware-v2.png`. Final prompt:

> Use case: precise-object-edit. Asset type: exactly registered polished metal stem photograph for a BMX configurator. Edit this 1536x1024 bike photo. Change ONLY the small top-load stem just below the handlebar, in the approximate rectangle x1020–1125 y250–310, to brilliantly polished chrome aluminum with deep charcoal studio reflections, narrow bright silver softbox highlights, clearly defined machined edges, bolt recesses and realistic metal depth. Preserve the stem's exact top-load shape, outlines and location. All handlebars, headset, white frame, wheels, spokes, cranks, pegs, pedals, seat, brakes, cables, original background, shadows and every other pixel must remain unchanged. No redesign, no new parts, no text or logos, no shift in camera, framing, crop, resolution, or geometry. Output is an aligned image whose stem will be composited precisely into the original.

### `studio-chrome-front-stem-v3.png` / `.webp`

Edit target: `studio-metal-v2.png`. Final prompt:

> Use case: precise-object-edit. Asset type: exactly registered polished metal stem photograph for a BMX configurator. Edit this 1536x1024 bike photo. Change ONLY the small front-load stem just below the handlebar, in the approximate rectangle x1020–1125 y250–310, to brilliantly polished chrome aluminum with deep charcoal studio reflections, narrow bright silver softbox highlights, clearly defined machined edges, bolt recesses and realistic metal depth. Preserve the stem's exact front-load shape, outlines and location. All handlebars, headset, white frame, wheels, spokes, cranks, pegs, pedals, seat, brakes, cables, original background, shadows and every other pixel must remain unchanged. No redesign, no new parts, no text or logos, no shift in camera, framing, crop, resolution, or geometry. Output is an aligned image whose stem will be composited precisely into the original.

### `studio-jetfuel-options-v3.png` / `.webp`

Edit target: `studio-chrome-options-v3.png`. Final prompt:

> Use case: precise-object-edit. Asset type: aligned photographic jet-fuel metal handlebar for an interactive BMX. Edit this exact 1536x1024 photograph. Change ONLY the four-piece chrome handlebars into polished PVD oil slick / JET FUEL metal. Deep saturated electric cyan-blue on the forward-facing surface, dark violet-purple and magenta along the curved edges, occasional gold reflected transitions, narrow brilliant silver-white highlights and deep charcoal reflected shadows. Iridescent colours follow the physical curvature and angle of each tube individually; no single world-coordinate rainbow gradient. Preserve the exact shape, silhouette, thickness, welded joints and grip positions. Keep grips white. Preserve stem, headset, bicycle, every other component, frame, fork, seat, wheels, pegs, shadows, background, camera, framing and pixel geometry otherwise unchanged. Photoreal product photograph with high-contrast polished metal reflection detail, no extra parts, no text or logos. Entire image must align exactly with the original photograph for compositing only the handlebar area.
