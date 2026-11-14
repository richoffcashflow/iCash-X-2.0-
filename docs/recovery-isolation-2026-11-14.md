# Independent work and visible recovery failures

The November 14 deep reliability investigation reproduced orchestration failures
in the actual maintenance and journey routes. A running worker alone did not
establish customer progress. The changes below preserve existing database claims,
source checks, financial holds, provider identities and customer controls.

| Reproduced failure | Corrected behavior | Regression evidence |
| --- | --- | --- |
| Customer deal journeys did not start until supervisor and owner-only delivery finished. | All three independently claimed lanes start together; all results are observed before the response. | Delayed, throwing and returned-error actual-route scenarios; no duplicated invocation. |
| Maintenance recorded a healthy heartbeat before inventory, export recovery, capacity recovery and cleanup completed. | Their results participate in the maintenance batch before monitoring. Claim/read exceptions remain distinct from ordinary held work. | Delayed lane completion, independent progress, failed claims, ordinary holds and private error responses. |
| Seller recovery exceptions became status objects followed by HTTP 200. | Five caught recovery lanes contribute fixed failure names and HTTP 503 after independent work finishes. | Acquisition enabled/disabled, delayed failures and retained seller response handoff. |
| Incoming call recovery swallowed failed retry checkpoints. | Other claimed rows continue; missing checkpoint persistence then reports an incomplete run. | Null and throwing writes for deletion/reconciliation; original holds retained. |
| Incoming maintenance ignored customer-phone errors and could return before its other lane finished. | Both lanes are awaited; thrown errors and returned error counts fail the run. | Real route authorization, delayed completion, returned errors and ordinary holds. |

The focused tests fail against the predecessor behavior and pass after the
changes. An independent reviewer inspected the final runtime changes and ran the
new failure matrices. Local TypeScript and the relevant existing route/service
suites are required; canonical exact-head Reliability checks still govern release.
No paid provider demonstration, historical resend, unknown-operation release or
customer-interface change is part of this patch.

## Production evidence and limits

Read-only observations around 11:49–11:50 AM Central on November 14 showed a
healthy worker/maintenance heartbeat alongside degraded workflow health. The
moving monitor reported 184 accounts with pending work and six without completed
work. These are investigation flags, not a proven preventable-stall count and
not the separately frozen 363-account cohort.

The previous hour contained 34 call dispatches across nine accounts, three new
texts across one account (two accepted, one delivered), and 15 research receipts.
Successful account reconciliation was much more frequent than customer output.
Old unsent texts, expired contact checks and established-sender readiness remained
separate issues. This patch does not reopen those sources or prove that every
account has recovered. Some underlying services still encode provider failures
as held/pending outcomes; that remaining classification must be investigated
without relabeling legitimate waits as outages.

PR #727 owns continuation fairness, durable recovery checkpoints and canonical
text receipt collection. Its disabled database prerequisites, exact release and
separate activation must be verified independently. PR #728 owns today's seller
conversation/voicemail changes; PR #731 owns tone. Preserve those concurrent
changes during integration.

## Release and observation

There are no new schema, provider configuration or feature-flag prerequisites
for this route/service patch. Use the existing automatic release process and
verify exact main-push CI plus production web identity. The changed routes run on
the web service; they do not require changing worker concurrency or replaying a
job. Observe natural maintenance responses, original recovery checkpoints and
actual account outputs after deployment. A new correct HTTP 503 may reveal a
pre-existing failure; it is not by itself a new outage or a repaired workflow.
