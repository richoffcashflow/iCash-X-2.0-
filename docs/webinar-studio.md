# iCash X webinar studio

The owner manages sessions at `/webinaradmin` (`/webinar-studio` remains an alias). Each new webinar immediately receives a permanent numeric `/live/<code>` URL. `/webinar` remains the general entry point. The existing verified owner account protects all editor, script-drafting, upload and analytics APIs. Knowing an email address never authenticates a visitor.

## Publish a session

1. Create a session; upload an MP4/WebM/MOV or supply a direct HTTPS video URL. MP4 with H.264/AAC offers the broadest browser compatibility. The storage project's own upload cap also applies.
2. Follow Video & details → Offers → Timers → Chat & AI → Review & publish. Duration and every timed moment use Hours / Minutes / Seconds. The video supplies its duration when metadata is available. Add up to 12 offers, each with its own headline, reveal time, CTA, destination and optional fixed deadline. Select an ending offer or use the latest available one.
3. Add timed host notes or import CSV/JSON. CSV columns: `time,name,message,kind`; `time` accepts seconds or `mm:ss`, and `kind` is `host` or `replay`. Use only genuine past comments for replay entries. `{{name}}` inserts the viewer's saved first name.
4. Add approved facts/FAQ for AI answers. Pasted transcripts can generate a draft host-note timeline for review.
5. Save and publish the Day recording. It runs at all hours until you choose **Add night version**, upload that recording, and save with automatic switching enabled. Day and Night keep independent video, chat, offers and timing under one permanent link. Night defaults to 6 PM–6 AM in the visitor’s local timezone; change those hours in Settings. Existing sessions keep their recording and saved place.

The numeric link always opens its own webinar, without traffic optimization. After a viewer reaches the offer, the fixed checkout return window still applies. The generic `/webinar` entry retains its ordered return journey across published webinars. Authenticated product customers and verified paid guests use the existing account/checkout handoff.

## Daily overview and results

Overview opens on **Today**, with Yesterday, Last 7 days and Last 30 days beside it. Reports default to America/Chicago calendar days, with an explicit timezone selector and automatic minute refresh while visible. Local calendar boundaries include daylight-saving changes. The webinar table includes all revisions so editing a title or offer does not erase that day's results. Day and Night rows appear separately once a Night version exists; attribution follows the session snapshot, not the current clock. Traffic optimization is disabled.

- **Viewers:** unique visitors who started playback in the selected period.
- **Add to cart:** unique visitors who explicitly selected an available offer or started its checkout. Automatic offer appearance remains a separate impression.
- **Checkouts:** unique visitors associated with a canonical live Stripe checkout creation. Private database triggers cover membership, credit and daily-plan checkouts; previews, test checkouts and unmatched guests are excluded. Retries do not duplicate the visitor. Browser requests cannot directly submit `checkout_started`. Measurement failure does not prevent checkout creation.
- **Purchases / revenue:** verified webinar-attributed payments, dated when paid, including purchases from people who watched earlier and applicable recurring payments. Amounts use the existing verified attribution source, including recorded funding tax. Refund/review records and test payments are excluded. Revenue represents collected payments, not projected daily budgets.
- **Conversion rate:** unique visitors who started watching and made an attributed purchase within the selected period, divided by unique viewers in that period. An earlier-day viewer buying today contributes today's purchase/revenue but does not inflate today's viewer close rate.

- **Average watch time:** tracked forward playback per started session in the reporting period, capped at the recording’s length. The same row shows average percent watched and completions. Paused wall time contributes nothing; a seek cannot add more than elapsed server time. Reports include the latest saved checkpoint from resumed sessions.

Owner-only `/api/webinar/reports` reads the service-only `icash_webinar_daily_report` RPC. Reports expose aggregates, not contact records. New cart/checkout instrumentation starts with this release; old offer-opening events are not retroactively relabeled as payment starts. Consented Meta measurement includes AddToCart alongside InitiateCheckout and verified Purchase.

Playback autostarts muted with `playsInline`; a large sound/play overlay handles browser restrictions. Hiding the page pauses it. Progress syncs every 15 seconds and on pause/page exit, with a session-scoped local checkpoint every 5 seconds. Media reloads seek to the latest position. Entry, chat, activity and checkout requests are bounded; optional panels fail independently of video. Completion clears the local checkpoint. Server-side session snapshots keep ongoing playback stable when the owner edits a webinar. The first prompt at 30 seconds asks only for first name. Chat uses Guest until saved. Phone and email appear together at least 30 watched seconds after saving the name, or at the configured contact time for a returning named viewer. A skipped prompt gets one reminder after 5 additional watched minutes.

The pitch opens a compact checkout beside the video and minimizes chat. The player stays mounted. Once checkout begins, later offers and the ending countdown cannot interrupt it. Built-in iCash X offers share the current software price and terms; custom product offers use their own HTTPS or internal destinations. Owner previews cannot create payments.

The end-of-video redirect shows an eight-second countdown with a Stay here option. Optional offer deadlines are fixed timestamps; they do not reset. By default the audience badge counts actual distinct viewers whose visible player is active. Heartbeats update every 30 seconds and expire after 75 seconds; multiple tabs count once. Paused, hidden, preview, completed and superseded sessions are excluded. In Video, the owner can hide the badge, set a simulated target audience, or choose a changing simulated minimum/maximum. A target such as 800 starts lower, builds toward the target, fluctuates slightly above and below it, then tapers near the end. The curve follows the configured video length and varies by session. Existing fixed numbers automatically become targets. Both simulated modes are labeled “simulated viewers.” The deterministic display resumes with the session and does not enter real analytics. AI replies and replay content are labeled.

## Purchase pop-ups

In Offers, **Purchase & funding pop-ups** starts with the first available offer by default. An optional later timestamp uses Hours / Minutes / Seconds. Choose a minimum interval from 15–120 seconds (default 30) and whether to include approximate location. The editor's illustrated example is explicitly labeled as an example, never a real purchase. In the room each pop-up displays for six seconds above the bottom bar and can be dismissed for the rest of that tab's session. Checkout and sign-in suppress pop-ups. Hidden tabs stop polling; displayed event IDs survive refresh in session storage. No fresh verified activity means no pop-up.

`/api/webinar/activity` requires the signed visitor's own session, same-origin requests and rate limits. A service-only RPC selects confirmed live funding and first software payments from the last 15 minutes, attributed to an actual started webinar by server-set guest/account binding. Test, pending, future, refunded/reviewed, unbound, preview-only and self purchases are excluded. Daily and membership renewals never appear as new buyers. A prepaid credit purchase says “added $10 to their bot”; a first daily payment says “started a $10/day bot budget.” The amount uses actual credited funds, excluding processing fees and taxes. Each notice retains its real event age.

Only a session-scoped opaque ID, activity type, amount, timestamp and optional coarse region leave the server. Vercel's trusted country/region headers supply a US state or country on entry; unavailable location is omitted. City, raw IP, name, email, account ID and payment ID are not in the feed. The owner can disable notifications or locations server-side for already-open rooms. Each future installation replaces the verified billing query and hosting geolocation adapter with its own; purchases remain isolated by deployment/database.

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

Analytics report cookie/resume-link visitors, starts, opt-ins, pitches, checkout openings, completions, tracked playback time and visitors associated with confirmed live payments. Owner previews are excluded. Clearing cookies or using an unlinked device can produce a separate visitor.

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

## Permanent links and verified value

Create and Duplicate each allocate a fresh numeric code in PostgreSQL. Changing a title, recording, offer or night schedule never changes that code. Session creation and resume are scoped to that webinar, so opening a second link cannot replace an unfinished session on the first. Day is the fallback until a usable, enabled Night recording exists. No CBO/traffic allocation control is shown or enabled.


A verified live funding order or settled membership invoice contributes the actual paid amount (including recorded funding tax). Each payment is attributed once to the last started session within seven days, using the server-issued guest binding or authenticated account binding. Self-entered email is not proof of payment. Test/pending payments and billing-review/refund/dispute records are excluded. This measures paid value rather than net profit, LTV or ad-spend ROAS.

## Meta setup

In Settings, enter the company's Pixel/dataset ID. Configure `ICASH_META_ACCESS_TOKEN`, an explicit supported `ICASH_META_GRAPH_VERSION` such as the version selected for the Meta application, and `ICASH_APP_ORIGIN` on the server. The studio reports connection readiness without returning any token. Measurement stays disabled until configured and enabled; production is the only environment allowed to transmit.

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

## Results by recording

My webinars and Daily results show Today by default, with Yesterday, 7-day and 30-day filters. Results span saved revisions and split Day/Night by the recording actually served. Verified purchases keep their existing payment IDs and Meta deduplication rules. Switching recordings does not create another Purchase event.

## Validation record — October 4, 2026

- The previous launch was published after explicit user approval and is live at `/webinaradmin` and `/webinar`. The former GitHub publication block is resolved. The separate Resend webhook approval is still outstanding.
- 198 repository suites plus the added post-purchase component-handler suite pass. The new tests cover typed offer timing, links, key-mode matching, payment consent, owned-session reuse, completed-payment protection, carried details, saved bot preferences and verified account handoff.
- The isolated Postgres test executes all four webinar migrations, including actual audience deduplication, pause/leave ordering, expiry, preview isolation and distinct-buyer close rates. All four migrations are applied in the configured Supabase project.
- Portable-engine TypeScript, app TypeScript, the full Next.js production build and whitespace checks pass.
- No live charge, reminder email, Meta event or owner webinar was created by these tests. Recordings still need to be supplied and published by the owner. End-to-end embedded payment verification remains pending the matching production publishable key.

## Checkout return window — October 4, 2026

The owner sets **Settings → Local time & returning visitors → hours** (0–72, default 3). Once a visitor reaches the pitch timestamp and a pitch impression is recorded, or completes the recording, their next entry within the window returns the last eligible offer they opened, or the latest revealed eligible offer. The built-in software offer uses `/join`. Expired offers are skipped. The existing verified-payment/customer check runs first. Viewing milestones and completion timestamps are persisted; page refresh and return visits never restart the clock.

At expiry, an unpaid viewer receives the next eligible unseen recording, even that same day. A viewer leaving before the offer keeps normal same-day resume behavior. The engine always considers the latest non-preview, non-superseded session, so an older expired recording cannot skip a newly started one. The new session RPC can skip the specific expired session while still reusing a newer session created by a concurrent tab. Advancing does not fabricate completion. Setting the window to 0 advances immediately on return.

## October 6 update verification

Focused checks cover separate recording edits and selection, numeric links, prompt sequencing, bounded network requests, media reload recovery, checkout ownership, API validation and private analytics. The isolated Postgres run checks numeric code allocation, cross-link resume, playback accumulation excluding pauses, Day/Night report aggregation, verified purchase attribution and existing RLS/grants. Tests use synthetic data; no payment or email is sent. No production webinar recording existed when this update was verified. A full real-device playback/upload and live checkout test still needs the owner’s recording and account.


## Timers

Each Day/Night recording has a **Timers** step with **Add timer**. Add up to eight countdowns, each with a video reveal time, label, duration or fixed closing date, placement above the offer or below the video, and an at-zero action (hide or show a message). Times use Hours / Minutes / Seconds.

Duration timers start the first time the viewer reaches their cue. The server stores the deadline by visitor, webinar, recording version and timer ID. Refreshes, multiple tabs, pauses, later sessions and edited revisions cannot extend it. To create a genuinely new countdown, add a new timer. Fixed deadlines use an absolute timestamp. Timers use server time; a missing timer response hides an unconfirmed countdown and retries without interrupting playback or checkout. Owner previews demonstrate countdowns against the video timeline without creating saved deadlines.

Timers control display, not payment terms. An actual offer closing date is configured in Offers. No timer creates purchases, scarcity counts or Meta events. Existing sessions keep their saved webinar configuration; newly saved timer settings apply to new sessions.

## Simple Intelligence view

Intelligence starts with an automatic routing switch, the smart link, status/current winner and a compact results table (visitors, buyers, close rate, average watch). The active audience remains visible. Audience/ad filters, planned traffic, revenue per visitor, baseline comparisons and Meta URL parameters live under Advanced. Routing and purchase measurement are unchanged.
