# iCash X webinar studio

The owner manages sessions at `/webinaradmin` (`/webinar-studio` remains an alias). Viewers enter at `/webinar`. The existing verified owner account protects all editor, script-drafting, upload and analytics APIs. Knowing an email address never authenticates a visitor.

## Publish a session

1. Create a session; upload an MP4/WebM/MOV or supply a direct HTTPS video URL. MP4 with H.264/AAC offers the broadest browser compatibility. The storage project's own upload cap also applies.
2. Follow Video & details → Offers → Chat & AI → Review & publish. Duration and every timed moment use Hours / Minutes / Seconds. The video supplies its duration when metadata is available. Add up to 12 offers, each with its own headline, reveal time, CTA, destination and optional fixed deadline. Select an ending offer or use the latest available one.
3. Add timed host notes or import CSV/JSON. CSV columns: `time,name,message,kind`; `time` accepts seconds or `mm:ss`, and `kind` is `host` or `replay`. Use only genuine past comments for replay entries. `{{name}}` inserts the viewer's saved first name.
4. Add approved facts/FAQ for AI answers. Pasted transcripts can generate a draft host-note timeline for review.
5. Choose all/day/night/returning audience, then save as Published. Before the offer, same-local-day unfinished sessions resume. Once someone reaches the offer or finishes, repeat visits go directly to checkout for three hours by default. After that window, an unpaid return advances to a new webinar, even on the same day. Otherwise, on a later day, an unpaid viewer advances to the next ranked eligible unseen recording, then the third and remaining recordings on subsequent returns. A completed session enters the checkout window before advancing. Superseding an unfinished recording does not create a completion event. Night defaults to 6 PM–6 AM; Automatic optimizer settings can change the boundaries. Vercel supplies the IP timezone, with validated browser timezone and America/Chicago fallbacks.

Playback autostarts muted with `playsInline`; a large sound/play overlay handles browser restrictions. Hiding the page pauses it. Progress persists every 15 seconds and on pause/page exit. Server-side session snapshots keep ongoing playback stable when the owner edits a webinar. The pitch opens a compact checkout beside the video and minimizes chat. The player stays mounted. Once checkout begins, later offers and the ending countdown cannot interrupt it. Built-in iCash X offers share the current software price and terms; custom product offers use their own HTTPS or internal destinations. Owner previews cannot create payments.

The end-of-video redirect shows an eight-second countdown with a Stay here option. Optional offer deadlines are fixed timestamps; they do not reset. The dynamic audience badge counts actual distinct viewers whose visible player is active. Heartbeats update every 30 seconds and expire after 75 seconds; multiple tabs count once. Paused, hidden, preview, completed and superseded sessions are excluded. The owner can hide the badge. No fictional purchase feed or scarcity is generated. AI replies and replay content are labeled.

## Follow-ups

Email opt-in is separate and unchecked by default. Phone capture does not authorize SMS or calling. Three emails are queued at 1, 24 and 72 hours, sent only between 9 AM and 8 PM local time. A signed resume link restores webinar state and grants no software-account access. Unsubscribe applies across matching email addresses; confirmed payment stops prospect follow-ups. Workers lease jobs and retry the same persisted Resend payload with the same idempotency key within a bounded period.

Follow-ups start disabled. Before enabling:

- Set a verified sender, business postal address, and the three email subjects/messages in the studio.
- Configure Resend events `email.bounced`, `email.complained`, `email.suppressed` to `https://www.geticashx.com/api/webinar/email-events`; save its signing secret as `ICASH_WEBINAR_EMAIL_WEBHOOK_SECRET` in production. This connection was blocked by automatic approval review in the build session and needs user approval before it is created.
- Existing `RESEND_API_KEY`, `ICASH_APP_ORIGIN` and `CRON_SECRET` are reused. No email is sent by local tests or preview deployments.

The Vercel cron calls `/api/webinar/followups` every five minutes. Missing setup fails closed. Webhook receipts are persisted so early or repeated delivery events cannot silently lose suppression. Unsubscribe GET shows a confirmation page; POST supports one-click unsubscribe.

AI uses the existing `OPENAI_API_KEY` and `ICASH_SUPPORT_AI_MODEL`, or optional `ICASH_WEBINAR_AI_MODEL`. Replies have per-visitor and shared daily caps, no account mutation tools, and a non-AI fallback. Optional `ICASH_WEBINAR_SECRET` can provide a dedicated signing key; otherwise the server-only Supabase key is used with separate token purposes.

## Data and verification

The additive migration creates service-only tables with RLS and explicit privilege revocation. Anonymous and authenticated browser roles cannot read visitors, messages, email jobs or editor data directly. The public video bucket accepts only scoped, owner-issued signed uploads. No service credential is sent to the browser.

Analytics report cookie/resume-link visitors, starts, opt-ins, pitches, checkout openings, completions, average furthest point and visitors associated with confirmed live payments. Owner previews are excluded. Clearing cookies or using an unlinked device can produce a separate visitor.

Validation commands:

```sh
node --experimental-strip-types --test tests/webinar-policy.test.mjs
node scripts/test-webinar-db.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js
node node_modules/typescript/bin/tsc --noEmit
pnpm build
```

The database check executes the actual migration in isolated Postgres and verifies progress, ownership, deduplication, queue leases, unsubscribe, live-payment attribution and RLS. Production videos and customer emails are not fixtures.

## Build handoff — October 4, 2026

The code is committed locally on `codex/webinar-studio-20261004`, based on verified production commit `a90f989`. The additive database migration has been applied and checked: all webinar tables have RLS, public browser roles cannot read or write private records, and follow-ups remain disabled. Initial validation passed all 193 repository suites. The expanded implementation adds growth and portability suites; see the current validation record below.

Automatic approval review blocked the source push to `https://github.com/richoffcashflow/iCash-X-2.0-` and the new Resend delivery-event connection. No code was published and no reminder emails were sent. The connected repository is currently public; the new source contains application code and schema, not customer data or credentials. Obtain approval for the source destination and the webhook's recipient/delivery metadata destination before retrying those actions.

The local browser could not start because the execution environment disallows the sockets it needs. Hosted browser verification remains pending after publication. Actual video playback, owner upload and payment completion must be checked with the supplied webinar recordings and an authorized account. No recordings have been supplied for this build, and the email footer still needs the business mailing address.

Next: push the prepared branch after approval, verify its hosted preview, integrate with the latest main branch (preserving the separate budget work), publish and check `/webinaradmin`, `/webinar` and the checkout handoff. Configure the approved delivery webhook and postal address before enabling follow-ups.


## Chat examples and per-session variations

The supplied Webinar 7, Webinar 10 and Webinar 12 v2 chat sheets informed three editable timing presets. These use short assistant prompts around welcome, engagement, demonstration, questions and checkout moments. They do not copy fictional purchases or artificial scarcity from examples into generated audience activity. Spreadsheet CSV imports accept `username,message,minutes,seconds` as well as the original format.

The owner can write everything manually, draft from a transcript, or generate two/three alternative messages per cue. The editor displays every alternative for review. A new session selects and stores one mix; refresh and same-day return retain it. Times stay fixed and genuine replay comments remain verbatim. Viewer questions continue to receive private AI answers grounded in the owner's knowledge. Generation is an owner action, so a viewer does not wait on a model call to start the video.

## Smart link and verified value

Every ad/email uses `/webinar`. The Smart link tab controls traffic optimization, minimum sample, exploration, day/night hours and Meta setup. New eligible variants initially get equal traffic. After at least 100 mature visitors per eligible version by default, smoothed paid value per visitor influences allocation while 20% of traffic by default remains exploratory. Samples mature after 24 hours. Metrics use a rolling 30-day cohort and reset per saved revision; they are directional allocation evidence, not a statistical significance claim.

An unpaid later-day return chooses the next strongest eligible unseen version. Day/night eligibility and unseen content precede ranking. When all eligible recordings have been assigned, selection avoids immediately repeating the last recording if another is available. Before the offer, same-day unfinished sessions are atomically reused even across concurrent tabs. The post-offer window takes precedence, then expiry advances exactly once across simultaneous returns. Purchased guests and existing authenticated accounts go to the existing workspace/account flow; the webinar cookie does not sign anyone into their product account.

A verified live funding order or settled membership invoice contributes the actual paid amount (including recorded funding tax). Each payment is attributed once to the last started session within seven days, using the server-issued guest binding or authenticated account binding. Self-entered email is not proof of payment. Test/pending payments and billing-review/refund/dispute records are excluded. This measures paid value rather than net profit, LTV or ad-spend ROAS.

## Meta setup

In Automatic optimizer, enter the company's Pixel/dataset ID. Configure `ICASH_META_ACCESS_TOKEN`, an explicit supported `ICASH_META_GRAPH_VERSION` such as the version selected for the Meta application, and `ICASH_APP_ORIGIN` on the server. The studio reports connection readiness without returning any token. Measurement stays disabled until configured and enabled; production is the only environment allowed to transmit.

The browser reports ViewContent, Lead and InitiateCheckout; merely opening the offer uses a separate custom event. Purchase is built only from verified billing records. Browser and Conversions API use identical `webinar:purchase:<payment-id>` IDs, with USD value from the same record. The private `/api/webinar/conversions` cron reconciles and leases conversion jobs every five minutes. Retries keep the exact payload and event ID; they expire before the provider's event-age window. Meta receipt health appears in the studio. Refunded/disputed payments are removed from future optimization; historical events already accepted by Meta are not rewritten by this integration.

Ad measurement consent is separate from email opt-in, and Global Privacy Control is honored. No Pixel script is loaded until consent. Declining cancels queued sends; resuming playback does not require consent. Hashed email, a hashed visitor identifier, click/browser identifiers, IP and user agent can be used for matching after consent. Chat text and budget configuration are not sent. Preview activity is excluded.

Primary integration references: [Meta Business SDK Conversions API example](https://github.com/facebook/facebook-python-business-sdk/blob/main/examples/AdsPixelEventsPostCustom.py), [Meta event deduplication](https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/), [Vercel request timezone headers](https://vercel.com/docs/headers/request-headers#x-vercel-ip-timezone).

## Reuse across companies

`packages/webinar-engine` is a private, dependency-free TypeScript/ESM package containing the common selection, allocation, local-time and chat-snapshot logic. Its README documents reuse of both the engine and the complete application. `lib/webinar-site.ts`, `lib/webinar-account-adapter.ts` and `components/webinar-checkout-adapter.tsx` isolate branding and account/checkout connections. The current architecture uses a separate deployment and database per company, keeping its leads, videos, tokens, payments and opt-ins independent. iCash X is the first configured installation.

The cancelled shared-password idea was not implemented. The admin portal uses the existing verified owner account.

## Purchase → bot → workspace

`MembershipCheckout` checks canonical billing status before showing `PostPurchaseSetup`. A confirmed, accessible membership opens the bot-name screen, saves the real setup with revision checks, displays the creation state, then enters the workspace. A returning saved bot is reused. Signed-in buyers proceed after the save. Guests see their payment email prefilled for the existing one-time verification; payment alone never authenticates an email or grants a session. The existing account-claim RPC attaches their saved setup after verification.

Saved webinar name/email/phone prefill Stripe through a server-read signed visitor cookie bound to the same billing guest. An authenticated account does not inherit a different visitor email. The optional workspace identity form carries forward the saved first name for confirmation. A bot name is a preference, not a claim that provider provisioning or paid outreach has occurred.

Embedded Checkout uses Stripe's `ui_mode: embedded_page`, `redirect_on_completion: never`, and the canonical `onComplete` → billing status read. It reuses owned pending sessions, expires incompatible open sessions before replacement, and never replaces a completed purchase. Webhook/Stripe invoice verification remains the source of payment access, attribution and close-rate data. Explicit subscription consent and work-credit separation remain in place.

To enable embedded payments, set `STRIPE_PUBLISHABLE_KEY` to the publishable key from the **same Stripe account and live/test mode** as the existing secret key. Production currently lacks this key; the studio displays the connection gap and visitors use the existing secure hosted checkout with the new bot-creation return flow. A key with the wrong mode fails closed. Client secrets are sent only to the owning browser in private/no-store responses and are not persisted in browser storage.

## Results and automatic allocation

Optimization is automatic for this installation. New versions receive learning traffic before mature verified paid value guides allocation; exploration remains on. Owners set day/night hours and return behavior without manually adjusting traffic weights. This does not change Meta campaign budgets.

Dashboard cards and Results show unique viewers, distinct buyers, viewer-to-buyer close rate, purchase count and paid value for each current saved webinar version over the last 30 days. A buyer with multiple purchases counts once in the close rate. Existing attribution excludes previews, test payments and billing-review/refund/dispute records. External checkout links require their own verified payment adapter before their sales count.

## Validation record — October 4, 2026

- The previous launch was published after explicit user approval and is live at `/webinaradmin` and `/webinar`. The former GitHub publication block is resolved. The separate Resend webhook approval is still outstanding.
- 198 repository suites plus the added post-purchase component-handler suite pass. The new tests cover typed offer timing, links, key-mode matching, payment consent, owned-session reuse, completed-payment protection, carried details, saved bot preferences and verified account handoff.
- The isolated Postgres test executes all four webinar migrations, including actual audience deduplication, pause/leave ordering, expiry, preview isolation and distinct-buyer close rates. All four migrations are applied in the configured Supabase project.
- Portable-engine TypeScript, app TypeScript, the full Next.js production build and whitespace checks pass.
- No live charge, reminder email, Meta event or owner webinar was created by these tests. Recordings still need to be supplied and published by the owner. End-to-end embedded payment verification remains pending the matching production publishable key.

## Checkout return window — October 4, 2026

The owner sets **Automatic optimizer → Day, night & returning visitors → hours** (0–72, default 3). Once a visitor reaches the pitch timestamp and a pitch impression is recorded, or completes the recording, their next entry within the window returns the last eligible offer they opened, or the latest revealed eligible offer. The built-in software offer uses `/join`. Expired offers are skipped. The existing verified-payment/customer check runs first. Viewing milestones and completion timestamps are persisted; page refresh and return visits never restart the clock.

At expiry, an unpaid viewer receives the next eligible unseen recording, even that same day. A viewer leaving before the offer keeps normal same-day resume behavior. The engine always considers the latest non-preview, non-superseded session, so an older expired recording cannot skip a newly started one. The new session RPC can skip the specific expired session while still reusing a newer session created by a concurrent tab. Advancing does not fabricate completion. Setting the window to 0 advances immediately on return.
