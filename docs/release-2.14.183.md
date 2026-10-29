# JKCREW 2.14.183 — Daily check-in reminders

Recovery mode now has a daily reminder setting and a device notification setup
button. Riders and their authorised coaches can choose the time and time zone.
The coach can see whether a device is registered; the rider sees the status of
the device they are using. Enabling push preserves existing notification
preferences and unfinished check-in answers.

The existing Supabase scheduler checks every five minutes. Reminders are opt-in
for each recovery period and send once per day, only when the check-in has not
been saved. Recovery mode, device registration, quiet hours and the current
check-in are checked again before delivery. The delivery window is two hours,
bounded by midnight. Normal training alerts remain suppressed during recovery.

Notification text contains no symptoms or plan details. Tapping it opens the
Check-in page without clearing an existing draft. The configured time zone also
sets the check-in day; historical entries are preserved. Existing quiet-hour
preferences continue to use the account's country time zone.

Verification includes 15 database scenarios, 58 notification delivery checks,
reminder UI and existing recovery UI checks, 63 app integration checks, 50
full-page recovery checks, 50 installed-app update checks and release smoke.
Tests use synthetic accounts and devices. Production verification confirms the
cron job and reminder configuration, with historical check-ins unchanged.

Device permission and actual lock-screen receipt must be confirmed on the
rider's phone. No notification is reported as delivered without a registered
device. Browser permission, Focus settings and an offline phone can delay or
prevent display after push-service acceptance.
