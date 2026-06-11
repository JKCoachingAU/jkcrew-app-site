# JKCommunity Square Connection

## Simple Version

1. Put the app online with HTTPS.
2. Copy the live webhook link: `https://your-site.com/api/square-webhook`.
3. Paste that link into Square Developer Dashboard > Webhooks.
4. Copy Square's access token and webhook signature key into your hosting environment variables.
5. Put the Square location ID into the JKCommunity Square Sync page.
6. Match each Square lesson product to the correct JKCommunity class.

## The Two Links

Square sends orders here:

`/api/square-webhook`

Parent texts send from here later:

`/api/send-sms`

## Square Environment Variables

Add these in your hosting provider:

- `SQUARE_ACCESS_TOKEN`
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `SQUARE_WEBHOOK_NOTIFICATION_URL`
- `SQUARE_ENVIRONMENT=production`

## SMS Environment Variables

Only needed when you are ready to turn on parent signup texts:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `JK_APP_SIGNUP_URL`

## Square Setup

1. Deploy this app to HTTPS.
2. In Square Developer Dashboard, create a webhook subscription.
3. Set the notification URL to:
   `https://your-domain.com/api/square-webhook`
4. Subscribe to paid order/payment events for the Square Online store. Start with Orders events and confirm the dashboard event names available for your account.
5. Copy the Square webhook signature key into `SQUARE_WEBHOOK_SIGNATURE_KEY`.
6. Add the Square access token to `SQUARE_ACCESS_TOKEN`.
7. Set `SQUARE_WEBHOOK_NOTIFICATION_URL` to the exact same URL used in Square.
8. In the app, map each JKCommunity class to the exact Square product name, variation name, or catalog object ID.

When Square sends a paid Term 3 lesson order, the backend verifies the Square signature, retrieves the order, normalizes the rider and parent details, and prepares the signup SMS.

## Current Connection Status

The frontend and webhook functions are ready, but this cannot be fully connected while the app is running on `127.0.0.1` or `file://`.

To go live you still need:

- A public HTTPS deployment URL.
- Square production access token.
- Square webhook signature key.
- Square location ID.
- Square lesson product names mapped to the right classes inside the app.
- Twilio SMS credentials if parent signup texts should send automatically.

## SMS Setup

This scaffold uses Twilio for SMS. After setting the Twilio variables, queued signup messages can be sent from the Square Sync screen.

## Data Mapping

For clean automation, Square products should be named clearly, for example:

- `LEVEL 1 | TERM 3 | MONDAY | JOSH`
- `LEVEL 2 | TERM 3 | WEDNESDAY | JOSH`

Use the same value in the app's `Square product or variation name` field for each class.
