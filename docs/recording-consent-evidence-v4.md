# Shared final recording-consent evidence v4

## Behavior

Owner tests, recorded customer outbound calls, and recorded incoming reception use the same pure affirmative grammar, decimal confidence parser and explicit contact-stop matcher. Owner exports remain compatibility wrappers. The previously reviewed grammar is unchanged.

For future calls, a correctly authenticated, fully bound final Gather response containing an unambiguous whole-response affirmative is the operative evidence. Confidence is advisory: a valid decimal from 0 through 1, or its absence, is preserved honestly. It cannot turn unclear speech into consent. Examples covered by signed SQL-backed tests include `Yep.` with `0.6769525` and `Yes, it's okay.` with `0.97909707`.

Malformed, out-of-range, duplicate, partial, negative, mixed, conditional, or unclear responses remain rejected. Existing exact action URL, signature, account/call identity, nonce, state/CAS and call-clock/deadline checks remain in place. Recording and AI registration still occur only after durable consent and recording-start confirmation.

New evidence is labeled `owner-final-natural-affirmative-advisory-v4` or `recorded-final-natural-affirmative-advisory-v4`, with `confidencePolicy: advisory`. The original recognized affirmative and bounded raw decimal are retained; no score is fabricated. Prior evidence versions retain their original validation rules. Historical rejected/settled runs are not replayed, relabeled or modified.

The diagnosed consent-stage failures occurred before ElevenLabs registration or media streaming. This parsing correction does not establish that reported choppy Twilio introduction audio is fixed; audio quality still needs a listening test.

Twilio documents that confidence accuracy and presence are not guaranteed: https://www.twilio.com/docs/voice/twiml/gather#action

## Contact stop versus recording refusal

During the signed consent step, a request not to record ends the call without creating a do-not-contact entry. An explicit contact-stop request is independently checked in JavaScript and SQL, then atomically inserts the existing phone suppression and requests termination. Existing suppression triggers revoke matching legacy permissions and operational contacts and cancel applicable pending work. Inverse requests such as “Don’t stop calling me” or “Don’t remove my number” do not create suppression; a separate genuine stop request in the same result still does. Provider END failures remain recoverable by maintenance with capture disabled.

Outbound suppression targets the immutable called recipient. Incoming suppression targets only the canonically bound caller. Anonymous, restricted or unknown inbound callers are ended without an invented phone or suppression identity. Stop requests are scanned within the existing signed-webhook body bound, independently of the shorter affirmative limit. Their full text is not added to recording rows, audit metadata or logs.

## Deployment

Apply these additive SQL files, in order, before deploying code:

1. `config/recording-consent-evidence-v4.sql`: private pure validators and owner grammar compatibility wrapper.
2. `config/owner-recording-advisory-consent-v4.sql`: new owner evidence version; old versions, allowance, lock order and recovery preserved.
3. `config/required-call-recording-consent-v4.sql`: outbound consent/explicit contact-stop branches only.
4. `config/recorded-reception-consent-v4.sql`: incoming consent/explicit contact-stop branches only.

There are no new environment variables, provider settings, prompts, ASR models, Gathers, holds, rates, budgets, approvals, live call actions or activation steps in this patch. The existing greeting-outside-Gather ordering is preserved. Customer dispatch capture guards are preserved.

## Verification

Focused tests reuse the approved grammar and verify shared wrapper identity, actual score preservation, both example replies, malformed numeric boundaries, negative/qualified speech and private-helper permissions. SQL-first compatibility and byte comparison protect the unchanged lifecycle/settlement branches. Existing signed owner, outbound and incoming flows cover recording, withdrawal, call limits, deferred identity/cost recovery, private playback and independent deletion. Additional suppression tests cover real existing recipient-revocation triggers, anonymous callers and failed-END recovery.
