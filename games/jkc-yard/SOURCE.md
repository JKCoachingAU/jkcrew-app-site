# JKC Yard

Completed BMX Yard 2.6 (Claude artifact version 22), recovered on 20 September 2026 from the owner’s already-loaded game resources. This is a static snapshot, not a live connection to the Claude workspace.

The game’s JavaScript, styles, textures, and 3D library are included locally. The Claude preview runtime was removed, the HTML document structure restored, and the standalone manifest link removed because JKCREW already supplies the app shell. The game’s automatic fullscreen request is skipped when embedded so JKCREW’s Back and Exit controls stay accessible. Only cosmetic rider/kit preferences are stored locally; game scores do not award JKCREW training points.

To update, replace this directory with a complete tested static export of the next finished game version, retain third-party license notices, and run `tests/jkc-yard-game.cjs` plus `tests/shred-zone-ui.cjs`. Keep relative asset URLs so the same game works from the main app and Riley preview.

Third-party notices: `vendor/THREE-LICENSE.txt`, `vendor/BARLOW-OFL.txt`, and `vendor/BARLOW-CONDENSED-OFL.txt`. Missing original Google Fonts weights were restored from the official fonts.gstatic.com distribution using their exact original filenames.

JKCREW release 2.14.143 fixes intermittent blank frames by applying adaptive resolution changes before drawing each frame. The game entry and app script use release-specific URLs so installed apps receive the fix. Gameplay, controls, locations and scoring remain the exported version.
