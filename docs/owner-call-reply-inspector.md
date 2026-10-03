# Private owner-test captured-reply inspection

The existing private owner-recording-test page now offers an explicit, read-only “Inspect captured reply” button for each ended owner test. It does not inspect production lead conversations, dial, record, retry, change consent, settle costs, or update stored state. It adds no schema, grants, credentials, feature enablement, or third-party dependency.

## Authorization and provider boundary

- Reuse the current authenticated `workAccount` owner guard and receipt-release flag.
- Accept one existing run UUID only. Reject call/account/URL inputs and extra or duplicate parameters.
- Query fixed config 1 and the run using current account/user filters, then verify both returned identities, attempt 1–3, config snapshot, configured numbers, and provider account.
- Read only that run’s linked call using the existing server-side Twilio provider. Verify canonical account/from/to/outbound-api identity and terminal status before reading Events.
- Wait until the carrier’s end time is at least 15 minutes old.
- Match POST callbacks to the exact production consent origin/path and verify callback account, call, run ID, and original nonce hash. Never return callback URLs or nonce values.
- Stop immediately on provider 401/403. No retries, scopes, feature activation, identity changes, or alternative credential paths.

## Bounded read and output

Use the existing timeout, redirect rejection, 256 KiB JSON-body bound, no-store fetch, and omitted browser credentials. The overall inspector has a 25-second signal. Read at most three pages of 100 events. Validate pagination origin, exact account/call path and limited query fields; reconstruct the known canonical API path rather than following the supplied URL.

Return only attempt number, completeness/counts, and matching callback summaries: short speech result, field presence/validity, numeric confidence when valid, partial-field flag, event timestamp, and numeric HTTP response. All matching events are represented, including multiple final results. Speech text is withheld whenever an unstable/partial field is present. Missing data is never converted into consent or refusal. Provider failures, unexpected bindings/page formats, and page caps report incomplete evidence explicitly.

Reply spelling, case, and punctuation are preserved except detected URL/email/phone/credential-like data and control characters, which are redacted and flagged. Raw speech over 1,024 characters is withheld before regex processing to bound CPU and avoid cutting through a credential. Otherwise the display is capped at 500 characters per reply, with truncation flagged. There is no raw response, header, query string, unstable transcript, response body, log, or new transcript storage.

## Verification

The focused synthetic suite covers owner/config/run/canonical-call binding failures, arbitrary IDs, partial/missing/empty/invalid speech and confidence, all matching results, multi-page and cap behavior, foreign/duplicate/unsafe pagination, provider denials, redirects and response bounds, output leak checks, owner route release/auth/parameter checks, no-store, click-only UI, and repeat-click/unmount guards. No live Twilio request or test call is part of the suite.

Reference: https://www.twilio.com/docs/voice/api/call-event-resource
