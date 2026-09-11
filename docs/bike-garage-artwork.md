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

## v4 — drivetrain and finished-bike scenes (2.14.99)

Seven original images were generated with the built-in ImageGen tool. Input files are this project's original photographic masters. No retailer photography is embedded. All outputs retain 1536 × 1024 registration; WebP delivery copies and 240 × 160 scene thumbnails were converted with Sharp. The original PNG sources are retained in `images/bike-garage/`.

The preview uses a photographic bike cutout, soft tyre contact shadows and subtle scene-specific ambient tone. Its camera view is fixed: pinch zoom, pan and image rotation inspect the existing image, not a fabricated 3D view. Exports retain the complete composition.

### `studio-lhd-v4.png`

Input: `studio-white-v1.png`.

Final prompt:

```text
Use case: precise-object-edit. Asset type: registered LEFT HAND DRIVE BMX component photograph for a bike customizer. Input image is the edit target, exact 1536x1024 white BMX studio photograph viewed from the bicycle's RIGHT side (front wheel to the right). Keep EXACT same camera, geometry, image dimensions, crop, bike orientation, frame, wheels, every spoke, seat, handlebars, fork, crank spindle and near pedal positions, white material, background, shadows and all other pixels. Change ONLY the drivetrain: this must become a genuine LEFT HAND DRIVE BMX, with the chain and sprocket on the FAR LEFT SIDE of the bike. Remove the currently visible near/right chain and sprocket. Reveal the right-side white crank arm and bottom bracket naturally without a near-side chainring. Render the far-side small white sprocket and metal chain partly visible BEHIND the seat tube, chainstays and crank, occluded correctly by the foreground frame. The far chain goes from far side of rear hub to far bottom bracket. Keep exact rear wheel and crank coordinates and believable BMX chain alignment. It is NOT a mirrored image; do not flip any other component or camera. No added pegs or brakes, no text, no logos. Highly realistic product photography. Only the rear-hub to bottom-bracket drivetrain region changes; the rest must remain precisely aligned for a masked image replacement.
```

### `scene-street-v4.png`

New background; no input image.

Final prompt:

```text
Use case: photorealistic-natural. Asset type: empty photographic background plate for compositing a realistic BMX. Output 1536x1024 landscape, no bicycle and no people. Low product-photography camera approximately 75cm above pavement, 55mm lens, very slight downward view. An authentic Australian inner-city street spot: subtly weathered grey concrete paving, low pale concrete ledge far behind, tasteful weathered brick and dark industrial doors and distant city detail in upper half. Foreground is wide EMPTY LEVEL concrete from y540 down to bottom, perfectly clear from x80 to1450 for a full-size BMX to be placed across the picture with wheel contacts around y900. Background must be comfortably behind subject plane, gently out of focus, no objects intruding through bike space. Bright but soft overcast neutral daylight from upper left, realistic diffuse ground bounce to match a white studio-lit product, no hard dramatic shadows. Fine concrete grain at realistic scale, faint scuffs, detailed natural environment, restrained charcoal/tan/grey colours. No painted bicycle, no riders, no text, no logos, no black silhouette. Professional editorial BMX product photography backdrop.
```

### `scene-skatepark-v4.png`

New background; no input image.

Final prompt:

```text
Use case: photorealistic-natural. Asset type: empty photographic skatepark background plate for compositing a realistic BMX. Output exact1536x1024 landscape. No bicycle and no people. Low product-photography camera 75cm above ground, 55mm lens, slight downward view. Real modern outdoor concrete skatepark, smooth concrete bowls and quarterpipes only BEHIND the subject plane in upper half, subtle coping, distant gum trees and soft pale sky, very gently blurred distance. Foreground x80..1450 and y530..1024 is a clear uninterrupted FLAT smooth pale grey concrete deck to place one full-size BMX at wheel contact y900. No foreground ramp, gap, ledge or objects obstructing bicycle. Soft neutral overcast morning daylight from upper left, bright diffuse ground bounce matching a studio-lit product photograph. Fine realistic concrete pores, wheel scuff marks and genuine skatepark forms. High-end photographic realism, no illustration or CGI/game graphics, no text/logos, no bicycle-shaped shadows. Subtle sport editorial atmosphere.
```

### `scene-warehouse-v4.png`

New background; no input image.

Final prompt:

```text
Use case: photorealistic-natural. Asset type: empty realistic BMX workshop background plate for compositing a bicycle. Output1536x1024 landscape, no bicycle, no people. Low product-photography camera about75cm above ground with55mm lens, slight downward view. Beautiful authentic industrial BMX workshop with tall black-framed factory windows admitting large soft neutral daylight from upper left, distant neatly organised wood workbench, indistinct hanging tools, dark steel cabinets and warm timber details across the upper half. Background behind subject plane, natural shallow depth of field. Broad EMPTY flat polished grey concrete floor from y530..1024 and x80..1450, wheel contact plane for later inserted BMX near y900. Diffuse window light and soft floor bounce; neutral bright foreground, moody but visible workshop distance. No harsh colour cast, no hard shadows, no glossy wet floor reflections, no objects crossing foreground. High-end real product photography, fine subtle floor scuffs, no illustration/CGI, no text/logos, no bike outlines or painted bikes.
```

### `scene-rooftop-v4.png`

New background; no input image.

Final prompt:

```text
Use case: photorealistic-natural. Asset type: empty photographic rooftop background for compositing a realistic BMX bike. Output1536x1024 landscape, no bicycle or people. Low55mm product photography camera75cm above ground, slight downward view. Safe broad urban rooftop terrace at early blue hour with a subtle peach-violet horizon and distant soft city skyline, low concrete parapet well BEHIND the subject plane in upper half. Foreground is open EMPTY dry pale grey concrete x80..1450,y530..1024 with subject contact plane near y900. Foreground illuminated by a broad neutral soft photographic fill light upper left, believable gentle skylight bounce; keep enough neutral light that a bright metallic bike photo fits naturally. Distant city lights glow subtly, fine realistic concrete texture, restrained colour atmosphere, no dramatic coloured light across foreground, no deep darkness, no wet mirror reflections. No objects intruding into bike space, no shadows shaped like bicycle, no text/logos. Premium real editorial BMX photograph background, not a videogame render.
```

### `studio-lhd-chrome-v4.png`

Input: `studio-lhd-v4.png`.

Final prompt:

```text
Use case: precise-object-edit. Asset type: exactly registered LEFT HAND DRIVE BMX photographic material reference. Input is edit target 1536x1024. Preserve exact same LEFT HAND drivetrain layout: far-side ring/chain remain behind the frame, NO near-side sprocket or chain. Preserve exact all geometry, camera, dimensions, tube outlines, wheel/spoke positions, crank arms, white grips/seat/tyres/pedals, original background and shadows. Change ONLY the material on the metal FRAME TUBES, CRANK ARMS, FAR SPROCKET and HUBS into polished mirror chrome steel/aluminium. Deep charcoal studio reflections, narrow silver-white softbox highlights and realistic welded and machined surfaces, curved reflection following each tube, strong tonal depth and fine edge detail. No illustration, no text/logos, no new components, no camera or silhouette movement. It must align exactly to original for replacing only the bottom-bracket/rear-hub region in a compositor.
```

### `studio-lhd-jetfuel-v4.png`

Input: `studio-lhd-v4.png`.

Final prompt:

```text
Use case: precise-object-edit. Asset type: exactly registered LEFT HAND DRIVE BMX photographic material reference. Input is edit target 1536x1024. Preserve exact same LEFT HAND drivetrain layout: far-side ring/chain remain behind the frame, NO near-side sprocket or chain. Preserve exact all geometry, camera, dimensions, tube outlines, wheel/spoke positions, crank arms, white grips/seat/tyres/pedals, original background and shadows. Change ONLY the material on the metal FRAME TUBES, CRANK ARMS, FAR SPROCKET and HUBS into polished PVD oil-slick JET FUEL reflective metal. Rich saturated electric cyan and deep violet/magenta with gold transitions, charcoal reflected shadows and narrow brilliant white specular highlights. Each tube reflects colour around its own cylindrical curvature, NOT a global rainbow gradient. Top tube cyan-blue/violet, down tube violet/magenta with cyan-facing reflections, gold naturally on stays. No illustration, no text/logos, no new components, no camera or silhouette movement. It must align exactly to original for replacing only the bottom-bracket/rear-hub region in a compositor.
```

## Stem junction and level pedals — 2.14.102

The built-in ImageGen tool created four registered sibling photographs from `studio-white-v1.png` and `studio-options-v1.png`. Original 1536 × 1024 PNGs and quality-95 WebP delivery images are retained in `images/bike-garage/`; delivery WebPs are mirrored in `riley-test/images/bike-garage/`. The renderer replaces the full stem junction and each pedal, then uses independently traced silhouettes for paint, interaction and background cutouts. Unchanged parts continue using the original photographs. These four optional assets load on demand outside the startup shell cache.

### `studio-top-plastic-v5.png` / `.webp`

Edit target: `studio-white-v1.png`. Final prompt:

```text
Use case: precise-object-edit. Asset type: registered photographic BMX component replacement for JKCREW bike customiser. Edit the supplied 1536x1024 photograph with EXACT same canvas, camera, crop, bike position, wheel centres, white seamless background, light, frame, fork, crank and handlebar geometry. Change ONLY two components: (1) Replace the small stem at x1020–1125,y250–310 with a mechanically plausible polished aluminium BMX TOP-LOAD stem. A compact single machined body connecting the existing steerer and bar clamp, clean horizontal top clamp cap with four recessed hex bolts, coherent joins, real metal reflections, no dangling clamp plates, no multiple overlapping stems. Keep existing handlebar lower cross tube and fork steerer connection EXACTLY where they are; bar tubing stays white, headset stays identical. (2) Replace the visible pedal around x775–910,y605–680 with a realistic neutral white NYLON COMPOSITE BMX platform pedal, fine grippy molded texture, open cage windows and small integral pins. Crucial: the pedal is LEVEL, its foot-contact plane parallel to the ground, long fore/aft platform edges almost horizontal in the image with only the slight perspective slope of the bike wheel contact line (slightly down to the right), not banked or tilted up to the right. Show the top and front edge with coherent perspective, a single straight steel axle connecting securely to the existing right crank endpoint at x782,y646. Do not rotate or move the crank. No residual old pedal behind new pedal. Real high-resolution product photography, sharp material grain and natural specular highlights. All other bicycle parts and every unedited pixel position unchanged. No brakes, pegs, added text, logos, illustration or watermark. Whole bike, no crop or closeup.
```

### `studio-front-metal-v5.png` / `.webp`

Edit target: `studio-white-v1.png`. Final prompt:

```text
Use case: precise-object-edit. Asset type: registered photographic BMX component replacement for JKCREW bike customiser. Edit this exact 1536x1024 photograph. LOCK canvas dimensions, camera, background, bike position, crop, wheel centres, all frame/fork/crank/handlebar geometry and lighting. Change ONLY two parts: (1) Replace the small stem in x1020–1125,y250–310 with a realistic compact polished aluminium BMX FRONT-LOAD stem: one solid machined body anchored onto the existing steerer, front-facing clamp faceplate enclosing the existing horizontal handlebar tube with four recessed hex bolts. No protruding vertical slab, no floating bolts or overlapping second stem, clean straight edges and realistic depth/reflections. Keep the handlebar tubes WHITE and exactly aligned, leave headset untouched. (2) Replace visible pedal in x775–910,y605–680 with a high-quality machined silver aluminium BMX platform pedal, low-profile body, open cage windows, chamfered edges and small black replaceable traction pins. Make pedal perfectly LEVEL relative to ground: foot-contact plane horizontal, fore/aft edges almost horizontal in image with slight downward-right perspective matching wheel contact line. No sloping-up-to-right or sideways banked platform. Spindle mounts exactly to existing right crank endpoint x782,y646; retain crank position and rotation. Show a believable top face and front edge of rectangular pedal, straight axle, matching bike perspective and softbox lighting, no leftover pedal underneath. Photo-real fine metal machining and natural reflections. Do not alter any other part, silhouette, background or source pixel geometry. No brakes or pegs, no added text, brand, watermark or illustration. Entire original bicycle, not zoomed in.
```

### `studio-four-top-v5.png` / `.webp`

Edit target: `studio-options-v1.png`. Final prompt:

```text
Use case: precise-object-edit. Asset type: exactly registered photographic BMX stem-and-handlebar junction for a bike customiser. Input is the edit target, 1536x1024 studio photograph with FOUR-PIECE BMX handlebars. Keep exact canvas, camera, crop, bike position, all white handlebar tubes and their silhouette/locations, grips, headset, fork, frame, seat, wheels, pegs, pedals and background. The FOUR-PIECE handlebar has a horizontal lower cross tube in front of the stem; preserve that exposed tube exactly. Change ONLY the metal STEM, approx x1020–1125 y255–315, to a premium polished aluminium TOP-LOAD BMX stem. Compact solid machined body with a horizontal top clamp cap and four recessed hex bolts, coherent bar clamp attaching to existing lower horizontal handlebar tube and unchanged fork steerer. Straight machined edges, subtle mirror reflections and real metal grain, correctly assembled single stem, no old stem collar or dangling plates. White exposed bar tube remains white, headset unchanged. Remove obsolete old clamp surfaces entirely inside replacement stem. No changes to handlebar geometry, brake additions, text, logos, distortion, illustration or other parts. Photographic fine detail. Keep every other pixel registered to the source; full wholebike image, not a closeup.
```

### `studio-four-front-v5.png` / `.webp`

Edit target: `studio-options-v1.png`. Final prompt:

```text
Use case: precise-object-edit. Asset type: exactly registered photographic BMX stem-and-handlebar junction for a bike customiser. Input is the edit target, 1536x1024 studio photograph with FOUR-PIECE BMX handlebars. Keep exact canvas, camera, crop, bike position, all white handlebar tubes and their silhouette/locations, grips, headset, fork, frame, seat, wheels, pegs, pedals and background. The FOUR-PIECE handlebar has a horizontal lower cross tube in front of the stem; preserve that exposed tube exactly. Change ONLY the metal STEM, approx x1020–1125 y255–315, to a premium polished aluminium FRONT-LOAD BMX stem. One solid compact machined body connecting the unchanged fork steerer to the existing horizontal lower bar tube, a clearly distinct forward-facing clamp plate with four recessed hex bolts, correctly assembled single stem, clean straight faceplate edges, polished real metal reflections and machining details. No jutting thin vertical slab, no floating bolts, no extra clamp collar from old stem. White exposed bar tube remains white, headset unchanged. Preserve exactly the FOUR-PIECE lower horizontal bar tube; never substitute a diagonal bent two-piece bar. No changes to other parts, pegs, pedals, background, or geometry, no new brake or text/logo/watermark. Full registered whole bicycle photo, not cropped or zoomed; photo realistic.
```
