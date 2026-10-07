# Seller SMS continuation

This change is separate from the multi-property routing release. It sends no test messages, places no calls, changes no spending cap, and expands no contact consent.

## Behavior and boundaries

Eligible, current, consented seller-intake conversations can continue beyond the original ownership/interest script: truthful identity/form-origin explanations, short process and price explanations, missing property details, call-time requests, and property-picture requests.

The AI selects an intent and extracts whole source statements. Its prose stays a draft. The database independently derives each outgoing reply and rechecks consent, identity, the latest incoming message, financial screening, manual/STOP controls, and property routing. Explicit human requests remain handoffs. Historical manual pauses are never reopened. Stale or financially held screening does not gain a bypass.

A requested date, AM/PM time and time zone are availability only. No appointment is booked by this change, and no call or completed call attempt is promised. Budget and provider gates still control actual calls. Negotiation, binding offer acceptance and unverified terms remain outside this SMS lane.

Incoming MMS attachments already remain on the matched SMS property thread and can be opened through trusted attachment links in the conversation UI. Ambiguous property routing requires review. Receipt does not verify picture content, address, condition or value. This change neither fetches arbitrary URLs nor promotes seller attachments into verified property assets.

Three first-contact variants use a durable per-lead recipient ordinal. Delivered messages are never rewritten and retry identity does not change. The current one-segment SMS limit still applies; long identities/addresses hold rather than silently truncate or bill additional segments. Distinct buyers still require valid account-owned sender routes.

## Rollout and verification

The earlier routing SQL prerequisite must exist first. Deploy and verify the new application source before applying this continuation SQL: the new service does not call the new queue RPC until the database emits sellerConversation=true. Applying continuation SQL first would expose its new analysis jobs to the old service during rollout. Local changes do not authorize a live migration or publication. Use supported migration tooling to create names, then record verified production history. Preserve the outcome of the separate routing release before integrating.

Policy and service tests use synthetic database/model fixtures, with no paid provider calls or messages. SQL scripts use isolated PGlite fixtures and stubs for existing provider/budget delegates. They verify local logic, not production provider delivery or billing. Recheck the final combined code, routing boundaries, idempotency, STOP/manual cases and SQL behavior before publication.

## Callback voice safety

An unresolved multi-property SMS routing hold also holds consented seller calls for that account/phone without binding the ambiguous message to a property. Clearing a routing hold never reopens an already held voice job.

Pending and canceled SMS call requests hold both reviewed and limited seller voice claims for the exact account, contact and property. Incoming scheduling answers to an actually sent call-time question are captured before model processing. Acknowledging an attention item is not permission to dial. Calls already dispatching are not falsely reported canceled, and resolving a request never automatically reopens a held call job.

The existing UI can resolve pending requests, but does not provide a reviewed restart for canceled requests or reopen held jobs. That restart is outside this patch; cancellation must not accidentally reactivate an old queued call.

## Recorded local checks

- 123 isolated continuation SQL scenarios and seven structural guard checks
- Stable three-recipient ordinal/copy SQL fixtures, including explicit possible-cash-offer purpose
- Focused SMS, AI-policy, service, routing, manual-retry and voice-context fixtures
- TypeScript typecheck and webpack production build

The default Turbopack build encounters the local shared-node_modules symlink restriction; webpack is the tested fallback. The prior aggregate account-activity-route fixture mismatch was corrected in the routing release and that fixture passes. No full aggregate pass is claimed; focused suites and isolated SQL are the release evidence.
