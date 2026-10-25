# JKCREW 2.14.168 — One-row event actions

The rider Upcoming Events card now keeps Saved runs, Going and Build run / Add run
in three equal columns on phones and desktop. Short visible labels keep the row
compact, while full accessible labels retain the original action descriptions.
Buttons keep at least a 44px touch target. Existing event IDs, handlers, saved-run
counts, attendance state and run privacy are unchanged. Coach controls keep their
existing layout.

Verified production card markup and styles at 320, 375, 390, 430, 768 and 1440px
in dark/light themes, with both attendance states and 0, 1 and 12 saved runs.
Checked alignment, clipping and touch target sizes, plus existing event, saved-run
and release smoke checks before publishing. Root and Riley assets are mirrored.
