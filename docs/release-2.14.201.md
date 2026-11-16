# JKCREW 2.14.201

The rider Session page now starts with the park from the rider's current-day active session. It includes that park in the venue selector even when no Daily list is assigned there, and preserves manual selections on refresh. Once adopted, the park stays available for the remainder of that day after the timer ends. This context clears when the account or riding day changes.

This fixes an active session falling back to the first assigned Daily park. It does not guess the venue of historical sessions or attach late trick entries to a closed session. Existing scoring RPCs and authorization remain unchanged.

Evie's four misattributed receipts were separately corrected to her confirmed Village visit. The session now reconciles to 14 points, with no additional earned points. Her Queen title preference is set. See the sanitized attribution report for verification and the pending all-time versus daily crown decision.

Validation: the focused venue-context test passed for active session adoption, manual selections, venue aliases, same-day retention, midnight and account changes, stale renders and real weekly/Lines/percentage action arguments. Rider session refresh and responsive Daily timer checks passed. Syntax, mirror/release smoke checks and diff checks passed. An independent review found no new race issue.
