# CashFlowKey webinar engine

Reusable decision engine for the webinar app. iCash X is the first installation. This package has **zero runtime dependencies** and runs in TypeScript/JavaScript projects independently of Next.js, Supabase, OpenAI, Stripe, or Meta.

It provides local-time routing, day/night eligibility, ranked repeat visits, value-based traffic allocation with exploration, and deterministic session chat snapshots. The surrounding application supplies verified purchase metrics, authenticates visitors, persists sessions, plays media, and renders the owner portal.

```ts
import {optimizedWebinar, freezeTimeline, visitorTimezone} from '@cashflowkey/webinar-engine';

const timezone = visitorTimezone(trustedIpTimezone, browserTimezone);
const selected = optimizedWebinar(
  companyWebinars, visitorHistory, timezone, verifiedPaymentMetrics,
  {enabled: true, explorationPercent: 20, minVisitors: 100},
  serverRandom, new Date(), {nightStartsAt: 18, nightEndsAt: 6},
);
const chat = freezeTimeline(selectedChat, sessionId, true, 'Your company assistant');
// Store selected + chat as one atomic session snapshot. Resume the saved snapshot.
```

Build from this repository:

```sh
node node_modules/typescript/bin/tsc -p packages/webinar-engine/tsconfig.json
```

The build produces ESM and TypeScript declarations in `dist/`. Copy/install the package into another application and run its `build` script after installing its development dependencies. It is marked private; publishing it is a separate owner decision.

## Reusing the complete app for another company

Use the webinar routes, room/studio components, and database migrations from this repository with these replaceable connections:

| Connection | Current installation | Replace for another company |
| --- | --- | --- |
| Identity and routes | `lib/webinar-site.ts` | Company key, brand, host, assistant, destinations |
| Owner/customer accounts | `lib/webinar-account-adapter.ts` | Verified owner identity, existing customer lookup, purchase lookup |
| Checkout presentation | `components/webinar-checkout-adapter.tsx` | The company's existing checkout component |
| Verified payment data | `icash_webinar_attributed_purchases()` in the growth migration | Canonical settled payments from that company's billing system |
| Storage and session persistence | Supabase server-only REST + SQL functions | The company's own database/storage credentials, or an adapter preserving ownership and atomic resume |
| AI | `lib/webinar-ai.ts` | The company's provider/model and approved knowledge |
| Measurement | Studio Smart link settings + `ICASH_META_*` environment variables | Its own Meta dataset and access token |
| Follow-ups | Studio Follow-ups settings + verified sender | Its own sender/domain, mailing address, consent and suppressions |

Public build settings: `NEXT_PUBLIC_WEBINAR_COMPANY`, `NEXT_PUBLIC_WEBINAR_BRAND`, `NEXT_PUBLIC_WEBINAR_HOST`, `NEXT_PUBLIC_WEBINAR_ASSISTANT`. Set `WEBINAR_OWNER_USER_ID` server-side for a new company; a non-iCash company fails owner access closed when that identity is missing.

The current rollout uses **one deployment and database per company**. Each owns its videos, leads, purchase history, Meta connection and email consent. A combined company switcher would require tenant-scoped database ownership and authorization before sharing a database. Source modules remain shared and versioned, so fixes can be carried across installations.

## Behavioral contract

- Paid or authenticated existing customers go through the product's own account/workspace flow. Webinar identity never authorizes account login.
- Before the offer, same-day unfinished viewing resumes the saved snapshot, even if an editor publishes a new revision.
- `returnVisit` sends repeat visits to checkout for a configurable period after the first offer impression or completion (default eight hours; completion starts its own full window). Refreshes do not extend the period. Once it expires, a direct return replays the same webinar. The latest session takes precedence over expired older sessions.
- A tagged paid ad may advance a known visitor only when its explicit destination has a saved completion plus at least 90% measured playback. New, partial and untagged visits stay on their requested webinar. Same-day resume and the checkout window take priority. VIP sessions never enter the public pool.
- Day/night matching uses a validated hosting-provider timezone, with browser fallback. A session in progress is stable.
- A published daytime recording also covers night until a usable dedicated night recording is published; the reverse fallback also works. Drafts and recordings without media do not disable this fallback. Returning-only recordings remain restricted to returning visitors.
- Public links are fixed. The narrow repeated-ad exception uses eligible unwatched sessions, ranks by verified paid conversion when sufficient data exists, and otherwise uses stable link order. Automatic ad experiments are retired.
- AI alternatives are reviewed before publication and selected once per session. Replay comments remain unchanged. AI notes are labeled.
- Purchase metrics come from verified live billing evidence. Refunds/disputes and test payments are excluded. Browser and server Purchase events share the same payment-based ID.

The example import presets are iCash X installation content. Each future company supplies its own scripts, recordings, offer terms and knowledge.

## Timed offers and duration inputs

`availableOffers` and `selectOffer` accept any offer shape with `id`, `at` (seconds) and an optional absolute `expiresAt` deadline. Selection respects reveal time, expiry and a visitor's preferred eligible offer. `splitDuration` / `changeDurationUnit` support hours, minutes and seconds without coupling the engine to React. iCash X supplies offer URLs, Stripe checkout, payment verification and actual audience heartbeats through application adapters. Other companies replace those adapters and use their own deployment/database.

`simulatedAudience` accepts `mode`, `fixedCount`, `minimum`, `maximum`, a stable session ID, playback seconds and an optional video duration in seconds (default 1800). It returns `null` for actual mode. The saved `fixed` mode now treats `fixedCount` as a target: it starts lower, ramps up over the opening part of the video, fluctuates around the target and tapers near the end. Pass the configured video duration so short and long recordings use the appropriate pacing. Counts remain stable for a session and playback position, stop changing after the configured ending, and vary between sessions. The `simulated` mode retains its changing minimum/maximum range. Both modes return bounded integers from 0 to 100,000. Render simulated values with an explicit label and keep them separate from measured attendance and conversion metrics. The room's recent purchase feed is a separate server adapter using confirmed payments; it is never generated by this simulation.

## Fixed links, repeat ads and paid VIP sessions

`paidAdArrival` accepts a numeric `ad_id`, or a named `utm_source` with a paid medium (`paid_social`, `cpc`, `ppc`, `cpv`, `display`, or `paid`). A `fbclid` alone, saved attribution, IP address or self-entered email never proves a returning paid-ad viewer. The app uses its signed visitor identity and server-owned playback history.

`confirmedWatch` requires a saved completion and at least 90% measured playback. The server adapter in `lib/webinar-ad-returns.ts` runs only after fixed-link resume and checkout-window rules. It excludes VIP, draft, unavailable, expired and confirmed watched alternatives. A previously selected alternative keeps its saved playback and checkout window. Optional selection failures keep the original webinar. The room updates its numeric path without reloading or removing campaign parameters; events and checkout remain attached to the actual session.

`bestConvertingWebinar` ranks the actual available Day/Night recording by verified cohort buyers / unique viewers over the last 30 days. A recording needs at least 20 viewers and one buyer; ties prefer larger samples then stable numeric link order. This is an observed conversion ranking, not an experiment or evidence of incremental lift. No Meta budgets, event names or purchase definitions change.

Every main webinar has its own paired VIP link with Day/Night recordings. Webinar checkout always saves that pair. Homepage checkout supports selected Day/Night VIP destinations, or the VIP paired with the strongest qualifying main webinar for that local time. Only published VIP destinations qualify for automatic selection. Selected defaults cover insufficient data or a reporting outage. Selection is frozen when creating checkout; live payment verification still gates access. An unavailable or draft selected VIP falls back to bot setup. Missing Night recordings play Day.

The portable `intelligence` exports remain available for historical integrations; the iCash X production entry route does not call them. Their settings and admin API are retired.

### Display timers

Import `timerDisplay` and the `WebinarTimer` / `TimerDeadlines` types from `@cashflowkey/webinar-engine/timers`. The pure renderer supports video cue timing, persisted relative deadlines, fixed timestamps, and hide/message expiry. Supply a trusted current time and server-persisted deadlines. The iCash X adapter stores the first deadline per visitor/webinar/recording/timer, independently of analytics and payments; another website can supply its own persistence.
