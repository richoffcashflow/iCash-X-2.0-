# Owner test consent evidence correction

Base: `5f520430fc687d12db8b0fa531f298128ea94351`, including the independently shipped diagnostic-only slice.

Scope: the isolated owner acceptance lane only. No customer outbound or incoming gate, provider branch/model/voice, immutable owner configuration, quote, allowance, claim/bootstrap function, or historical row changes. The single default-model speech Gather stays unchanged at its existing estimate. A rejected/ended attempt cannot be replayed into approval. This patch does not authorize or initiate another attempt.

## Corrected evidence contract

Only the existing signed final `/owner-recording-test/consent` action can reach the parser after exact nonce/account/call binding. Any `UnstableSpeechResult`, duplicate parameter, unknown/ambiguous/mixed/negated/non-whitelisted text, or absent speech remains non-consent. A reported confidence must be a decimal with at most 30 fractional digits and be exactly between 0.9 and 1 before numeric conversion. Its exact decimal text is preserved in confidenceReported. Nondecimal literals, exponent notation, padding and binary-rounding threshold crossings are rejected. An absent Confidence field is stored as JSON null with `confidenceBasis: not_provided`; it is never converted into a score. All accepted owner v2 evidence includes `evidenceVersion: owner-final-affirmative-optional-confidence-v2` and `resultKind: gather_action_final`. This is provenance of a provider transcription, not a claim of guaranteed ASR accuracy or consent by any additional participant.

Twilio explicitly says Confidence presence and accuracy are not guaranteed: https://www.twilio.com/docs/voice/twiml/gather#action . Selecting a specific model alone does not remove that limitation and changes the published Gather price from $0.02 to $0.025/use: https://www.twilio.com/en-us/voice/pricing/us . This release changes neither model nor price.

## SQL-first rollout

Review and apply only `config/owner-recording-consent-evidence-v2.sql`, then deploy the exact reviewed code. It replaces only `icash_transition_owner_recording_test(uuid,bigint,text,jsonb)` and reasserts its existing service-only grants. Legacy numeric-confidence payloads retain their original threshold so SQL-first deployment is compatible. Existing accepted evidence is immutable. No existing table data is rewritten. Do not rerun the original table/bootstrap SQL.

Do not make another test call until the previous attempt has canonical provider settlement and the separate audio-quality investigation is resolved sufficiently for a controlled retry. Existing allowance and its two remaining attempts remain authoritative. Read-only provider preflight must still pass. A missing-confidence correction cannot by itself prove why the earlier provider rejected speech or explain choppy carrier audio.

## Diagnostic-only alternative

The separate diagnostic-only manifest contains three files and requires no SQL. It retains the old acceptance rule. It adds allowlisted consent/receipt error categories, numeric confidence when present, speech classification without text, and carrier field type/validity booleans. No raw speech, phone, provider body, callback URL, nonce, signature, credential or arbitrary exception is logged. A recovery reason remains pending rather than releasing an unknown cost. This alternative can be deployed independently; it does not fix missing-confidence rejection.

## Local checks

- Focused parser/diagnostic tests, including absent/nonaffirmative, low/malformed, unstable and duplicate input.
- Actual-SQL PGlite flow: accepted missing-confidence final result through recording/registration/stop/settlement; malformed evidence; signed wrong-account/nonce/signature/partial-path; rejected-attempt replay; no-wallet or legacy allowance mutation.
- Full Node test suite and TypeScript.
- One final webpack build.

All provider calls in these checks are synthetic. No paid call, live capture, provider setup, live SQL, or deployment is performed by the local patch.
