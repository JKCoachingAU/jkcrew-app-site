Supabase JS browser UMD 2.116.0, bundled unchanged from https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.min.js.

This is the version served by the previous @2 CDN URL at the time of bundling. Self-hosting lets the app shell cache it and avoids a separate CDN connection during sign-in. License: supabase-LICENSE.

Three.js 0.180.0 browser ES modules are vendored from the official npm package (https://www.npmjs.com/package/three/v/0.180.0): `three.module.min.js`, `three.core.min.js`, `OrbitControls.js`, and `RoomEnvironment.js`. The two addons only change their `three` import to the local `./three.module.min.js`. License: `THREE-LICENSE.txt` (MIT). These assets load only on opening the 360° Bike Garage, with no CDN requests.
