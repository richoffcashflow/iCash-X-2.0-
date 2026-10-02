# One-use owner audio check

A separate, fixed owner-only inbound test. It does not use the old acceptance wallet reservation flow. The existing private provider branch must have a 60-second AI conversation cap; the existing queue may add at most 30 seconds. Provider fees may apply and forwarding pricing remains unverified.

## Deployment

Install `config/owner-audio-once.sql` once as trusted database owner, after review and approval. This creates an empty durable single-use record store and service-role-only RPCs. It does not arm, call, change provider routing/settings, or touch customer credit tables.

Deploy the application. In the signed-in configured owner’s `/owner-inbound-acceptance` page, choose **Check one-use readiness**. The server reads the exact private branch, phone assignment, and incoming Main callback settings. It requires no external tools, workflows, procedures, knowledge base, recordings, or unsafe queue/burst settings for the selected private branch, and pins complete configuration hashes and version. Incoming Main callback must use the exact authenticated app URL and match the private branch’s saved Authorization reference. Relevant override permissions are checked explicitly.

Only after approval, check the one-use consent and arm. The five-minute window is created atomically once. The eight-digit challenge is returned only once to that authenticated browser. Caller ID is merely a routing hint; the challenge is reconciled from authoritative provider GET receipts after the call.

The owner calls Contiguity +1 424-394-8384 from configured phone ending5280. The incoming destination remains Twilio +1 781-609-3521. No outbound request is sent. A missing `forwarded_from` is explicitly unverified, never invented. A positively different source is rejected. Passing means audio and dashboard-code evidence passed, not that forwarding or business calling is certified.

Refresh, cancellation, expiry, provider errors, callback replay or uncertain submission cannot reset the singleton. Admission consumes it before provider reads. SQL records immutable admission time and exact CallSid/conversation, preventing an inspection failure from being promoted to success. Further checks never call again. Failed/expired attempts require review rather than a reset mechanism.

## Verification boundaries

Local policy/service/HTTP tests use synthetic receipts. PGlite exercises the actual SQL, ACLs, immutable state, cancellation/claim races as serialized interleavings, and challenge/result restrictions. This is not a real multi-session PostgreSQL lock test. No real call or provider timeout behavior is proven by those tests.

Provider documentation describes startup failures but does not offer a universal non-2xx/timeout failure contract. The prior real401 call failed; other callback failure modes remain untested. Readiness validates Main callback configuration and reports its tool counts; this does not constitute runtime fail-closed verification.

No wallet, credit reservation, operation-spend, automation ticket, callback/handoff capability, or business conversation is created by this flow. Existing billing reconciliation requires independently created business operation/conversation records and cannot discover this isolated row as billable customer work.

## Temporary phone branch isolation

Before arming, the incoming phone must be pinned to the existing private 60-second,
no-business-tools branch. Main remains unchanged. The owner-only routing panel
prepares a signed snapshot before a branch-only provider PATCH, rechecks immediately
before sending it, and verifies readback. The original null or explicit Main branch
is retained in an immutable server-side singleton before the provider write; this
tab's session storage is only a convenience. The review button recovers the saved
review after a refresh, lost tab, or server restart. Pin can only be attempted once.
Never automatically retry an uncertain change: inspect the current assignment.
After the test ends, is cancelled, or expires, restore the original assignment
promptly and verify the provider readback. This is operator-driven restoration,
not an automatic timer. Keep the tab open until restoration is verified.

Official phone routing precedence is webhook branch, then phone-pinned branch,
then default. Pinning removes the unsafe Main default from this test path; it does
not independently prove provider call rejection when a webhook fails. The app's
one-ever gate remains authoritative for successful initiation responses.
Sources: https://elevenlabs.io/docs/api-reference/phone-numbers/update and
https://elevenlabs.io/docs/eleven-agents/integrate/environment-variables .

Arming and restoration are serialized by a shared database row lock. Once restoration starts, a stale arm cannot create an allowance. Pending, cancelled or uncertain calls wait through the five-minute window plus a 90-second tail; verified completed results can restore sooner. A short pin-settling hold also applies. This is a conservative operational guard, not a provider guarantee about delayed writes.
