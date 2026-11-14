# Seller maintenance recovery health

The November 14 reliability investigation reproduced an HTTP health-reporting
failure in the actual seller maintenance route. Exceptions in seller email queue
reads, agreement receipt recovery, milestone collection/delivery, research
refresh, and contact refresh were converted into status objects but the route
returned HTTP 200. Existing seller responses continued, which was correct, but
the failed recovery cycle appeared successful to its caller.

The route now records fixed private `recoveryFailures` lane names and returns
HTTP 503 after every launched lane has completed if one of these recovery
operations throws. Existing and newly assigned seller responses still proceed
independently. The same behavior applies when new seller acquisition is disabled.
Exceptions never expose database/provider error text in the response.

This is failure visibility, not authorization to repeat provider operations.
Normal returned workflow outcomes such as rate limits, current-contact holds,
disabled lanes and setup waits remain distinct from caught infrastructure
exceptions. No queue state, financial reserve, source expiry, sender identity,
contract authority, existing retry limit or customer UI is changed. Unknown
provider operations retain their original claims and recovery requirements.

`seller-maintenance-recovery.test.mjs` first reproduced the previous HTTP 200
after a failed email queue read. It now exercises all five recovery failures
with acquisition both enabled and disabled, includes delayed completion to prove
independent work proceeds and all started tasks are awaited, and checks normal
held outcomes remain successful maintenance passes. Existing handoff tests
verify new sellers still progress during agreement recovery failure. These are
offline, actual-route tests with fictional service boundaries; no paid provider
actions or production account changes were made.

The result does not repair the historical expired-contact backlog or prove live
delivery, and does not classify every returned review status as a service outage.
Deployment and production recovery must be verified separately.
