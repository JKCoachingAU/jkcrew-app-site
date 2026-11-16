# JKCREW 2.14.202

The coach Session view has a compact stopwatch face, clear playback-style start/pause/end controls, and native group and location selectors. Group and location remain locked during a live session; adding a park remains available. Elapsed-time and pause calculations are unchanged.

Points feedback now emphasizes the actual earned amount, trick name and verified weekly total in a compact, nonblocking card. A successful weekly tick shows one score notification. Failed saves and undo messages remain available; retired XP and badges stay disabled.

The rider health summary uses less space, with smaller headings, icons and metric tiles. Its readings and device connection workflow are unchanged. The owner's Teams overview uses compact coach account rows and country totals.

Tricktionary landings now require recorded tick evidence. Old points receipts no longer imply that a current or edited trick was landed; immutable landing snapshots retain the original trick. Manual history remains available as Recorded and is excluded from ticked-trick totals. Category and card controls use quiet, consistent buttons.

Trick Review supports a local second video, alignment at matching moments, linked playback/scrubbing/slow motion and selectable frame steps. The existing recorder combines both labelled views, coach drawings and voice into one private feedback video. The second source file stays local and clears when leaving the review.

The Teams tab is reserved for the platform owner and shows coach account information and aggregate student counts. New coach accounts must receive platform-owner approval before opening their workspace. Head coach, Coach and Assistant coach are separate team roles; invitations do not bypass account approval. Country selection alone never joins a team. Approved coaches manage their own membership and invitation codes from Profile.

Purchasing teams have separate database membership records. Restrictive table and Storage rules, guarded server functions, linked-record validation and notification checks enforce the boundary. The platform owner's account retains its own coaching membership; platform ownership grants only the coach-account overview and approval controls across teams. Existing program teams, student records and point receipts are retained. Park crowns and leaderboard ranks are calculated within the current team without changing the park-point scoring rules.

Approved colleagues share their team's riders, locations, training blocks, progress, runs and review media. Head coaches issue role-specific coach invitations. Every coach remains pending until the platform owner approves access, including invited assistants. Approved coaches can issue separate rider and parent invitation codes for signup or an existing account's Profile. Parent-to-child links still require the coach's explicit action.

Private caches and pending network responses are tied to the account and sign-in generation. Signing out, changing account or changing membership clears that context. Showreels use short-lived authorized URLs. Account creation derives registration ownership from the verified caller; account deletion checks current approval and the target's complete team membership before using Auth administration.

Validation includes isolated browser tests for the real signup, approval waiting screen, owner controls, family invitations, responsive layouts and account switching; database tests for pending denial, separate teams, shared coaches, linked-record injection, notifications and park crowns; and server-handler tests for forged callers, role restrictions, signup rollback and deletion authorization. Synthetic accounts and videos are used in automated tests.
