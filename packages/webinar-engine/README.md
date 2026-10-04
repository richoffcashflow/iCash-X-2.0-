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
- `returnVisit` sends repeat visits to checkout for a configurable period after the first offer impression or completion (default three hours). Refreshes do not extend the period. Once it expires, selection advances to a fresh webinar, including on the same day. The latest session takes precedence over expired older sessions.
- A later local day advances an unpaid prospect to the next eligible unseen webinar. Superseding an unfinished session does not count as completion.
- Day/night matching uses a validated hosting-provider timezone, with browser fallback. A session in progress is stable.
- A published daytime recording also covers night until a usable dedicated night recording is published; the reverse fallback also works. Drafts and recordings without media do not disable this fallback. Returning-only recordings remain restricted to returning visitors.
- New visitors explore eligible versions. Mature purchase value adjusts traffic while preserving an exploration floor. Returning visitors choose the strongest remaining eligible version.
- AI alternatives are reviewed before publication and selected once per session. Replay comments remain unchanged. AI notes are labeled.
- Purchase metrics come from verified live billing evidence. Refunds/disputes and test payments are excluded. Browser and server Purchase events share the same payment-based ID.

The example import presets are iCash X installation content. Each future company supplies its own scripts, recordings, offer terms and knowledge.

## Timed offers and duration inputs

`availableOffers` and `selectOffer` accept any offer shape with `id`, `at` (seconds) and an optional absolute `expiresAt` deadline. Selection respects reveal time, expiry and a visitor's preferred eligible offer. `splitDuration` / `changeDurationUnit` support hours, minutes and seconds without coupling the engine to React. iCash X supplies offer URLs, Stripe checkout, payment verification and actual audience heartbeats through application adapters. Other companies replace those adapters and use their own deployment/database.

`simulatedAudience` accepts `mode`, `fixedCount`, `minimum`, `maximum`, a stable session ID and playback seconds. It returns `null` for actual mode, a constant for fixed mode, or a bounded, deterministic changing integer for simulated mode. Render simulated values with an explicit label and keep them separate from measured attendance and conversion metrics. The room's recent purchase feed is a separate server adapter using confirmed payments; it is never generated by this simulation.
