# Admin and Webinar Studio conversion funnels

The owner admin now follows unique inbound seller leads through assignment, actual seller engagement, a signed purchase contract, a signed buyer assignment, and verified closing. Webinar Studio follows unique viewers through offer exposure, offer selection, a verified checkout start, and a verified purchase. Both show vertical proportions, stage counts, overall conversion, and the count and percentage that have not advanced between steps.

## Counting and access

- Seller reports start with canonical, nonduplicate inbound submissions received in the selected Central-time calendar period. They follow the same leads through the report update, including matches to multiple accounts only once. Search and the owner usage switch do not filter the funnel.
- Completed live signing envelopes with provider IDs are required for contracts and buyer assignments. Closing requires both signatures plus a confirmed closing update linked to a verified title reply. A planned closing date or a deal stage alone is insufficient.
- Webinar reports start with nonpreview viewers who actually started in the selected reporting period. Activity and purchases must follow their start, belong to the same webinar, and fall before the period end/current update. Returning sessions and multiple payments count once per viewer. All-webinar counts deduplicate a person across webinars. The selector affects only the funnel.
- Later verified outcomes establish earlier funnel stages when telemetry is missing. Drop-off means the person has not advanced in this period, not that they are permanently lost.
- Existing payment attribution remains unchanged: verified live payments, most recent started nonpreview session within seven days, reviewed/refunded payments excluded. Payment-date revenue cards can therefore differ from the same-viewer funnel.
- New RPC wrappers are stable, read-only, security invoker functions with an empty search path. Only `service_role` may execute them. The owner report retains its database actor check, and both API routes authorize the owner before querying.
- Loading or malformed reports never become zero counts. A failed same-period refresh keeps a clearly labelled prior view. Authorization loss clears private report data and stops background requests. Period changes abort old requests. No new dependencies or paid provider calls.

## Validation

Local tests execute the actual new SQL plus existing base report and payment attribution functions in PGlite. Seven scenarios cover stage evidence, duplicate leads and matches, signature/title exclusions, repeated webinar activity and payments, per-webinar scoping, previews/test/reviewed payments, a 25-hour DST day, period boundaries, owner/role restrictions, and complete empty reports.

Focused tests cover funnel math and accessible rendering, both reporting APIs, admin request recovery, Webinar Studio selection and request recovery, and the existing hard stop on paid development simulations. TypeScript and `git diff --check` pass.

The migration was applied before the application deployment. A read-only production check returned the 30-day seller funnel **8 → 7 → 3 → 1 → 0 → 0** and a zero webinar funnel for both saved webinars. Browser roles cannot execute either new function. No production activity was seeded and no paid simulations were run.

The migration is additive. Rolling the application back to its prior routes leaves the original reporting functions intact; no customer records need to be changed.
