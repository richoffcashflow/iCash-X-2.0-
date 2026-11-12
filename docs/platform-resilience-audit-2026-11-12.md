# Platform resilience audit — November 12, 2026

The owner requested a platform-wide review after automated calling stopped. The earlier calling repair in PR #687 restored compatibility with three confirmed inert provider fields. This follow-up reviewed shared transport and failure boundaries across calling, messaging, research, contracts, account access, support, storage and worker scheduling. The implementation starts from main `e6757436fb0282f1673fcc020c3b9eb62135b213`.

## Reproduced defects and repairs

| Failure | Affected paths | Repair |
| --- | --- | --- |
| Early HTTP, origin, media-type and size rejection abandoned an unread response | Outbound/inbound calling, capacity and number readiness, SMS, research adapters, signing, email, AI and storage | Explicitly cancel unused bodies before returning the original failure or fallback. Cleanup failure never changes that outcome or triggers another request. |
| Header-declared oversize failed before the stream reader's cleanup; some readers retained their lock | Shared recorded-call readers, general reception, voice preview and receipt recovery | Close rejected bodies at the header check and release reader locks on completion or failure. Keep existing byte limits and receipt validation. |
| A voice write received successful headers but its JSON body was malformed or interrupted | Shared ElevenLabs adapter | Classify it as `VOICE_WRITE_UNKNOWN_NO_RETRY`, matching a lost connection. Reads report a fixed invalid-response code. Preserve all original attempts. |
| Voice error diagnostics buffered an unrestricted error body | Shared ElevenLabs adapter | Bound error parsing to 8 KiB and retain only existing permission/validation identifiers and HTTP status. |
| Credential-bearing database/auth/storage requests used fetch's default redirect behavior | Database, sign-in, health probes, course and brand storage, upload initialization | Reject redirects at transport admission. No redirected write or forwarding of application credentials. Existing upload Location validation remains. |
| Successful storage copy/upload initialization returned without consuming its response | Brand images, course/webinar uploads, webinar storage optimization | Release unused success bodies as well as errors; retain status, destination checks and original publication behavior. |

Node's HTTP client documents why abandoned bodies can exhaust connections: [Undici response lifecycle](https://github.com/nodejs/undici#garbage-collection). The regression tests also reproduce the defect with a real loopback HTTP server that deliberately leaves a response unfinished; this is not inferred from source text alone.

## Reviewed boundaries retained

| Area | Checked behavior |
| --- | --- |
| Calling and reception | Exact provider identity/configuration checks, fresh admission, recording requirements, caller-number binding, separate result persistence and original unknown-outcome holds. |
| Messaging and documents | One-use dispatch claims, original provider receipts, opt-outs, recipient bindings, reconciliation after ambiguous sends, no automatic resend introduced. |
| Research and credits | Shared request admission and quota accounting, once-only paid claims, saved export recovery, actual-cost settlement and preserved uncertain purchases. |
| Account access | Existing authentication status distinctions, caller cancellation, session preservation during outages and tenant-bound access. |
| Worker scheduling | Independent lanes, bounded backoff, durable held-job acknowledgement, recurring claim-failure reporting and fresh capabilities. Existing worker fault tests already exercise these boundaries. |
| Health and support | Failed dependencies retain unavailable/degraded results. AI failures retain their existing fallback and unknown usage receipt. The independent monitoring work in PR #690 is a separate release. |

No UI, SQL schema, pricing, approval, consent, funding or provider configuration changes are included. No real calls, texts, emails, AI generations or data purchases are made by these tests.

## Verification

- `tests/provider-response-lifecycle.test.mjs`: HTTP failure cleanup across 13 adapter entry points, cleanup rejection, byte limits, media/origin rejection, deletion confirmation, malformed/interrupted voice-write receipts, contract/email reconciliation and real unfinished HTTP streams.
- `tests/http-response-lifecycle.test.mjs`: existing database/auth/worker cleanup tests plus real cross-origin redirect rejection and successful-header/body-stall cancellation. All provider requests remain single attempts.
- Before the patch, the five new provider lifecycle scenarios and redirect regression fail against the previous calling-repair revision; they pass with this change. The deadline test already passed and protects existing behavior.
- TypeScript and the complete repository suite are release checks. GitHub checks must pass on the exact PR head and merged main revision; production must serve that main revision before this work is reported deployed.

This is a review of shared failure paths across the platform, not a claim that every possible application bug or provider outage is eliminated. Provider credentials, entitlement, caller-ID verification and changed active agent behavior still require real evidence; code must not bypass those prerequisites to make a dashboard look healthy.
