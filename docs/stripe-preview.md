# Stripe Preview checkout
Test only. Requires VERCEL_ENV=preview and STRIPE_SECRET_KEY beginning sk_test_. Production always returns disabled. Public publishable key is not used by hosted Checkout. No live wallet, account access, or automation is granted by these payments.

## Preview environment settings
- STRIPE_SECRET_KEY: Stripe sandbox secret.
- SUPABASE_URL: https://ofjbbpwugyjfxbhqfguh.supabase.co
- SUPABASE_SECRET_KEY: server-only Supabase secret (not a publishable key).
- STRIPE_WEBHOOK_SECRET: signing secret for the deployed /api/webhooks/stripe endpoint.

Redeploy the Preview branch after changing settings. Never copy secrets into GitHub or chat.

Checkout looks up the start pack in the database, saves its price snapshot and creates a card-only Stripe Checkout session. Disabled production credit packs are used only as preview configuration. Guest test orders are bound to a random HttpOnly cookie using its SHA-256 hash. Test receipts are stored in a separate table. Returning from Checkout only triggers a server-side Stripe lookup, never an automatic credit based on URL flags. Settlement validates mode, currency, payment status, price, order metadata and session ownership, then uses an idempotent database RPC. Webhook fulfillment uses the same path.

The exact deployment hostname is required by the origin check. Opening a branch alias instead will be rejected; use the unique deployment URL. Vercel Preview authentication may block Stripe webhooks. Do not disable deployment protection automatically; use an approved publicly reachable test webhook destination or configure access intentionally. Return-page reconciliation can test signed-in preview checkout independently; webhook delivery must also be verified before launch.

## Limits before live launch
This is a guest sandbox flow, not paid account claiming. It does not issue real credits or emails. A later production integration needs verified ownership/account claiming, tax/refund/dispute handling, a durable event inbox, anti-abuse rate limiting, secure server credentials and a live mode review. The test status displays up to the latest 100 guest orders. No automatic reload is enabled.

## Verified
Local TypeScript/Next build, test-mode gates, unpaid/wrong amount/currency/order/live event rejection, raw-body signature tampering, database idempotency and private guest rows. SQL test fixtures rolled back. Real Stripe test payment and webhook delivery still require configured secrets and a user-completed test checkout.
