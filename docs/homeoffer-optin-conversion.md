# HomeOffer opt-in conversion testing

The seller page uses an address-first, two-step layout. The contact step collects name and phone and retains the existing exact contact agreement. Optional email was removed from the UI. Small displays and enlarged text can scroll naturally; controls are never clipped to force a fixed viewport.

Three approved headline/CTA combinations are tested: fast cash, selling as-is, and readiness to sell. `/api/seller/experiment` assigns a random version, stores a protected 30-day browser reference, and keeps repeat visits consistent. The experiment does not block the form if unavailable, and a version never changes after interaction starts. Known crawlers and GPC visits are not enrolled.

The private `icash_seller_optin_visits` table records unique views, form starts, contact-step visits, and server-persisted submissions. A trigger attributes the first nonduplicate intake using an identifier read from the HttpOnly cookie by the server. Client events cannot record a submission or qualification. Qualified results join the existing server-side property checks; there is no new paid provider call, outreach configuration, or ad campaign.

Allocation starts equally across the three versions. Source and mobile/desktop audiences are evaluated independently. The objective is a qualified request within 24 hours of the first measured view, using completed daily cohorts in a rolling 31-day window. Every version needs 100 mature views, the leader needs 10 qualified requests, and its 99% Wilson lower bound must exceed both alternatives' upper bounds. This is a conservative routing heuristic, not a formal statistical significance claim. A qualifying leader receives 80% of new visitors and each challenger 10%. Aggregate routing results are cached for five minutes. If the evidence stops separating the versions, allocation returns to equal exploration. All-time-in-window submission and qualification rates remain visible separately from the fixed routing objective.

Seller Operations displays visitors, starts, contact steps, requests, opt-in rates, qualified requests, and qualified rates, with audience filters. No ad spend is invented; CPA is not shown without attributable spend.

Validation: `tests/seller-optin.test.mjs`, `tests/seller-optin-route.test.mjs`, `tests/seller-funnel.test.mjs`, and `scripts/test-seller-optin-pglite.mjs <path-to-PGlite-index.js>`. SQL tests use an isolated database and synthetic records. No test calls/texts or paid property lookups are generated.

The account GET parameter's TypeScript annotation was made required to satisfy the Next.js route-handler build contract; account runtime behavior is unchanged.
