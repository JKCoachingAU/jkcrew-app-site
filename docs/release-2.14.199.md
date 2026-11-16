# JKCREW 2.14.199

The rider Daily timer card now puts the venue before the timer readout, with equal-sized Daily PB and Today's Time summaries. The ready state shows 00:00 rather than a second Go-style control. Start/Finish/View Result and Today's Progress use matching buttons, stacked full-width on mobile and aligned in a row on desktop. The card and refresh control follow the neutral training-page design.

Existing session, venue, timer, Daily result and progress hooks are preserved. Both app routes share the update.

Verification: ready, running and saved layouts passed browser checks at 320, 390 and 1024 pixels in dark/light themes. Buttons meet the 48px target, summaries align, and no labels overflow. Screenshots were inspected. Release smoke checks passed.
