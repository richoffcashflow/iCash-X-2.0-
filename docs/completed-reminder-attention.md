# Completed automatic reminders in customer attention

An expired no-response reminder that was already delivered is historical
outreach, not a new request for the customer to record a resolution. The old
expiry sweep retains it as needs_review with no review reason. Preserve that
stored history while excluding it from the customer attention projection.

The shared read predicate excludes only needs_review, expired, draft-stage, no_response rows
with no explicit review reason and a linked delivered outgoing message from the
same account that has no customer author. An empty LEFT relationship embed is a
receipt predicate and exposes no message body. Unknown delivery, missing receipt,
manual messages, newer reminders, other stages, genuine seller questions and
unrecognized review reasons remain visible. Existing contact_checks_expired
presentation filtering remains unchanged.

Apply the predicate before pagination in the attention list, property badges,
assistant needs-you context and legacy follow-up list. Do not mutate gap state,
messages, admission checks, consent, customer controls, billing or provider
receipts. The resolution action is unchanged and never sends a message or
restarts outreach.

Focused offline fixtures exercise hidden rows preceding visible requests,
cross-page and empty views, account boundaries, malformed/missing evidence,
manual versus automatic messages, unknown/failed delivery and intact history.
Direct and nested URL assertions check all receipt constraints. Full release
checks and a bounded authenticated PostgREST read of both query shapes are
required before calling the change live. Anonymous table access is denied and
must not be expanded for this validation.

## Authenticated release readback

The existing contact preflight also runs the metadata-only attention readback in
configured Vercel preview and production builds. It uses the existing database
configuration without retrieving or granting credentials. One bounded discovery
is followed by account-scoped source, receipt, direct-list and nested-badge GETs.
No message bodies, customer identifiers, provider operations or mutations are
logged or performed. The final source reread rejects a changing cohort.

The check compares actual projected IDs with an independent receipt-backed
oracle, including paged and empty results. HTTP failures, malformed metadata,
result mismatches and changed sources fail the build. Legitimately absent history
returns not_observed after bounded empty-query validation, never passed. Preview
without existing configuration returns not_configured; production requires it.

For this release, require authenticated preview logs with status passed and a
positive completedRemindersChecked count. Inspect retainedRequestsChecked too;
current genuine requests must match exactly, while future clean datasets need
not retain stale rows merely to permit deployments. Local and CI skips are not
a substitute for this observed proof.
