# Owner-reviewed workflow alert cleanup

The owner authorized removing or repairing the current 309 workflow flags on October 26, 2026. The reviewed live batch contained 159 text failures with exact saved provider callbacks reporting an unavailable sending line, 138 ended calls with incomplete final receipts, four uncertain provider outcomes (three calls and one text), and eight blocked seller workflows. The worker and maintenance were healthy when inspected.

This change acknowledges that exact batch as historical review. It does not mark the underlying work successful or settle an unknown cost. Provider receipts, message/job states, money reservations, recipient holds, original recovery work and core-service monitoring remain unchanged. No send, call or payment is repeated by acknowledgment.

`icash_reliability_private.workflow_acknowledgements` binds each review to its account, resource, issue kind and original occurrence timestamp. Its primary key supports the monitor's lookup. The application has SELECT access only; anonymous and authenticated clients have no access. Migration creates an empty table. The owner-approved batch is inserted separately from its exact reviewed manifest, with each classification rechecked against current records.

The compatible app uses `icash_refresh_reviewed_workflow_snapshot`. Filtering happens before the active top-25 page. A new resource or changed occurrence timestamp remains active. The report separately exposes up to 25 acknowledged items and their count. Actual receipt recovery removes an item from the currently pending reviewed list while retaining its audit row. The legacy refresh functions remain available for deployment rollback.

Admin shows active alerts and a collapsed reviewed-history section, with explicit labels for confirmed failures, ended calls awaiting receipts, unknown outcomes and blocked outreach. A history-only state says “No new alerts.” Recovery notices preserve the distinction between monitoring recovery and completed work.

Validation uses offline PostgreSQL fixtures for exact binding, wrong-account rejection, changed failures, pagination, immutable operational records, core-outage priority and access control. Existing browser scenarios exercise reviewed history, zero active alerts, a new active failure and clearing private data when owner access is denied. Production activation still requires the existing exact-main CI gate.
