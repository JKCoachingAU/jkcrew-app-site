# JKCREW 2.14.157 — Password-change feedback and recovery

Profile password changes could succeed in Auth and then crash because the
submit handler read `event.currentTarget` after awaiting the response. Native
events clear that reference, leaving the button stuck on “Changing…” without
a success message.

The handler now retains the form reference, blocks repeated submissions, and
restores the button on success, returned errors, thrown errors and timeouts.
Failed requests preserve input; successful requests preserve any newer edits.
Late responses after navigation, sign-out or an account change do not alter
the current screen. Password updates are never automatically retried.

Verification:
- Reproduced the original native-submit failure in Chrome with a successful
  synthetic Auth response: `Cannot read properties of null (reading 'reset')`.
- `tests/password-settings.cjs`: 86 browser checks covering delayed success,
  failures, repeats, input retention, timeout and stale-response protection.
- `tests/auth-resilience.cjs`: 49 login, signup, recovery, logout and mobile
  layout checks, including 320, 375 and 390 pixel widths.
- `tests/auth-startup.cjs`: 47 session restoration and auth race checks.
- Release smoke, JavaScript parsing and installed-app update checks.

Auth tests use isolated synthetic responses and make no production account
changes. Production account lookup and project health were checked read-only;
the user's new password was not requested or tested. End-to-end confirmation
of their sign-in remains with the user.

Root and Riley assets share version 2.14.157 and retain separate service-worker
cache namespaces. No database, account-email or permission changes.
