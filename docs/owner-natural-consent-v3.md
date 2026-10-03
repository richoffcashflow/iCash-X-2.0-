# Owner-test natural consent v3

## Scope and evidence

The owner-only final Gather action now recognizes a bounded whole-response grammar, rather than eleven exact strings. It accepts clear affirmative answers and permission clauses, including punctuation, common apostrophe variants, contractions, repeated affirmatives, and combinations such as “Yes, that’s fine. Go ahead and record this call.” The entire response must match one to six clauses and be at most 120 characters. It does not infer intent with an LLM or accept arbitrary high-confidence speech.

A sole direct affirmative token with an ASR-inferred question mark (for example “Yes?”) is treated like the same token without that mark. Actual question words, permission questions (“You can record?”), or additional clauses alongside a question mark remain rejected. Ellipses, negative/mixed/conditional/qualified responses, unconsumed words, missing speech, duplicated fields, and partial results remain rejected. Existing signature, exact final-action path, nonce, canonical call binding, current provider preflight, and timing checks remain required. Reported confidence must still be an exact valid decimal between 0.9 and 1; absent confidence is honestly stored as null. The original accepted provider utterance is preserved with `owner-final-natural-affirmative-v3` provenance. No historical result is replayed or reclassified.

No rejected transcript is newly retained. Diagnostics add only punctuation/repetition shape booleans. Owner contact opt-outs still end the call and block later attempts, including curly-apostrophe “Don’t ever call me again” and “I don’t want you to call me again.” Contact stop requests are scanned independently of the shorter affirmative limit, within the existing signed-webhook body bound.

The inspected application diagnostics showed a stable high-confidence result outside the old whitelist. Its exact recognized text and the cause of reported choppy audio are not established by this code change. A provider transcript must be inspected before claiming this corrects that particular call. No additional live trial is part of the software tests.

## Separate pending-price orchestration change

A separately requested owner test can follow a canonically completed pre-consent run in either failed or declined state while that earlier call’s carrier price is still null. The existing server-only fresh canonical receipt and row-version attestation, 30-second freshness, exact account/from/to/call/start/duration binding, no consent/start/recording/AI evidence, pending-price reason, no contact opt-out, and full $1 reservation are all retained.

The previous decline remains a decline. A new attempt asks for consent again. There is no automatic redial or release/reuse of the prior reservation. Three outstanding full reservations consume the entire unchanged $3 allowance and all three attempts. Unknown outcomes, observed overruns, expired authorization, contact opt-out, unrelated errors, and any recording or AI start remain blocking. No owner configuration, approval, expiry, legacy probe, customer wallet, or production customer gate is changed.

## Rollout

1. Apply `config/owner-recording-natural-consent-v3.sql` after the existing retained-reservation migration. It replaces only the owner transition, preserving the config-first lock order and overrun recovery, and adds a private grammar helper. It accepts the original v1 and v2 evidence contracts only with their original exact whitelist, permitting SQL-first deployment.
2. Apply `config/owner-recording-declined-reservation.sql`. It replaces only the private pending-carrier candidate predicate. The attestation and claim functions, privileges, budget arithmetic, and lock order are unchanged.
3. Deploy the reviewed code. No new environment variables, provider changes, ASR uses, model changes or rate changes are required.
4. Keep actual testing under the existing fixed owner allowance and explicit operator-controlled Start. Provider inspection and an independent review remain required before another trial.

## Verification

- Focused owner parser, diagnostics and retained-reservation tests.
- JavaScript/PostgreSQL parity for the grammar, plus signed real-handler natural-affirmative and refusal/partial/foreign/replay paths against actual SQL.
- Failed → declined → separate third attempt retains all three full reservations and preserves earlier rows. Opt-out, stale proof, foreign receipt and overrun remain blocked.
- Existing owner call lifecycle, private playback, independent deletion, and dial/settlement races.
- Full repository aggregate tests, TypeScript and a production webpack build.
