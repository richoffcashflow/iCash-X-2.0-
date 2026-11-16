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

## Repeated-request planning

The final live check reproduced an intermittent 30-day failure after the first query repair. The API connection inherits the authenticator's eight-second statement timeout, which is shorter than the application's fifteen-second fetch deadline. A generic prepared report plan estimated only 144 source events and one cohort row; production had about 27,000 events and 12,500 cohort rows. It chose nested loops over those cohorts and exceeded a bounded twelve-second diagnostic. The same report with a custom plan completed in approximately 4.5 seconds. These observations are not a guaranteed latency.

`config/webinar-report-planning.sql` source-pins the reviewed function definition and changes only its `plan_cache_mode` to `force_custom_plan`. Each call plans against its actual date window, including on pooled connections that favor generic plans. The SQL body, permissions, stable/invoker behavior, empty search path, reporting results and all deadlines remain unchanged. No global planner setting, schema/data rewrite, worker release or provider action is needed. Apply the separate forward migration once; the guard rejects unknown source and a second application.

The report equivalence fixture now runs six short prepared calls followed by every period/timezone combination with outer generic, custom and automatic planning. It verifies identical complete results, unchanged function source/ACLs, rejection of source drift and restoration of the caller's planner setting. A hosted service-role call with a generic outer plan completed within an eight-second diagnostic deadline. Planning-only rollback resets this function's `plan_cache_mode`; it retains the faster query but can restore the intermittent timeout.

## Bounded report deadline

Repeated live refreshes also caught an eight-second cutoff after custom planning was installed: this report's large historical snapshots still have variable execution time. `config/webinar-report-deadline.sql` source-pins that exact function and assigns only this reporting RPC a twelve-second database deadline, leaving three seconds inside the unchanged fifteen-second application fetch limit. It reloads PostgREST's function metadata so the API uses the setting. Role/global deadlines, other RPCs, the SQL body, access and results stay intact. This is bounded headroom for the optimized query, not a claim that a longer deadline makes it faster.

The fixture verifies the scoped deadline, complete report equivalence and restoration of the caller's timeout. Verify repeated authenticated long-range loads after applying the separate forward migration once. Reset only this function's `statement_timeout` to roll back the deadline change; reload the schema metadata afterward. The original eight-second cutoff then applies again.
