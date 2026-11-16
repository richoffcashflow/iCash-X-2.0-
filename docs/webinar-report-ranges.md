# Webinar 7-day and 30-day reporting

The owner reported that the longer reporting periods did not load on November 16, 2026. The existing buttons and API parameters were present. A bounded live read reproduced a database timeout for the 7-day report; the 30-day daily report also exceeded twelve seconds.

The old report repeatedly decompressed saved session configurations, recomputed purchase attribution for its separate funnel, and scanned the event set for each payment and reporting scope. A live 30-day funnel plan alone took approximately 9.8 seconds.

`config/webinar-report-ranges.sql` replaces only the existing service-only, stable, security-invoker report function. It selects the event/payment window first, extracts compact metadata once per relevant session, reuses that snapshot for the cards and funnel, and groups first starts before joining payments. The report schema, period labels, time zones, payment attribution, campaign/preview exclusions, watch calculations and distinct-person scopes remain unchanged. No UI changes, new tracking, customer messages, provider requests or longer request deadlines are required.

The migration is compatible with the existing `/api/webinar/reports` route. Apply the reviewed SQL once, then verify all four periods through that existing function and check the 7-day/30-day browser flow. Existing function grants and private HTTP authorization stay in force. No worker release or provider activation is needed.

Validation:

- `node --experimental-strip-types tests/webinar-report-ranges.test.mjs` executes both old and new SQL on identical synthetic data and compares every returned field across twelve period/time-zone combinations, including DST, repeat sessions, payment deduplication, previews, campaigns, test/reviewed payments and empty periods. It checks service-only execution, volatility and search path.
- `tests/webinar-reporting.test.mjs` covers the authenticated API contract; `tests/webinar-daily-dashboard.test.mjs` covers dashboard rendering.
- Read-only production EXPLAIN of the revised complete 30-day query completed in approximately 7.1 seconds, within the unchanged fifteen-second database request deadline. This is a measurement, not a guaranteed latency.

Rollback, if required, restores the previously deployed `icash_webinar_report_with_funnel` definition from `20261010020902_conversion_funnels.sql` with the regular-webinar view substitutions from `20261020041010_legacy_customer_launch.sql`. Rollback preserves access and data but restores the slow query.
