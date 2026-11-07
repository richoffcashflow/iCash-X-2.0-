# HTTP response lifecycle reliability

The November 7 audit reproduced three transport-resource defects in the actual
database helper, authentication helper, and worker dispatcher. Generic database
and authentication rejections left their response bodies unread. Successful
worker dispatches also ignored their bodies. A local HTTP server that kept its
body open confirmed that these requests retained the connection until later
cleanup instead of releasing it when the caller finished. Under repeated work
or upstream failures, unused response resources can accumulate. This is a
confirmed code defect, not a proven explanation of every production outage.

The helpers now cancel only the bodies they no longer need. Database reservation
errors still pass through the exact financial classifier before cleanup. Auth
retains the original HTTP status, and the worker retains its exact status and
durable-hold acknowledgment rules even if cleanup rejects. Successful database
and authentication payloads are still read normally. No request is retried, no
capability is reused, and no original receipt or financial hold is changed.

`http-response-lifecycle.test.mjs` exercises rejection statuses, cleanup failures,
financial classification, successful payloads, empty responses, acknowledged and
unacknowledged worker holds, and native loopback HTTP connections. All four
groups failed before the repair and pass afterward. The suite also runs in the
local release gate. It never contacts external providers or customers.

## Release and limits

This repair does not confirm SMS delivery, reconcile historical provider costs,
increase research quotas or establish that all customer workflows complete.
Production workflow evidence must be checked separately from transport cleanup
and process health.

Release requires the full current-head Reliability workflow, exact merged-main
checks, and matching production web and worker deployments. No migration,
provider configuration, paid test or account mutation is needed.
