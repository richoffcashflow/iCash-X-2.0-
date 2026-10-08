# Direct property conversation with saved audio

Owner requested on October 7, 2026, at 10:44 PM America/Chicago: keep audio recording, skip the spoken introduction and recording question on inbound and outbound business calls.

New sessions use `direct_recorded_v1`. They record operator authorization separately from historical caller speech evidence; no utterance or affirmative consent is invented. Existing spoken-consent sessions retain their original evidence and cleanup path. Provider recording must still be confirmed before connecting AI. Signature, exact caller/account binding, one-time claims, credit reservation, hard duration limits, stop requests, private playback and 30-day audio deletion remain in place.

A 100 ms silent carrier asset answers the inbound call. Signed setup binds the funded carrier time limit, then a second signed callback starts recording and registers the AI. Separating these steps keeps setup work within carrier webhook deadlines. The property question is the first spoken message. Seller and buyer outbound calls use the same direct entry, with their existing offer/contract tools and limits. A current, same-account SMS focus supplies the returning caller's property; stale, conflicting and suppressed routes do not.

The skipped speech Gather is charged at zero. Recording, storage, carrier, streaming and actual AI receipts remain in settlement. No wallet balance or historical reservation is reset.

Production preparation is an explicit deployment step behind `ICASH_DIRECT_CALLS_PREPARE=true`. It clones the existing reviewed inbound branch with zero traffic, changes only the conversation instructions, verifies the full result and stages a disabled database configuration. A durable claim prevents repeating an uncertain branch creation. Existing branches and number routing remain unchanged. Activate the staged configuration only after the new deployment is ready. Outbound uses its existing reviewed provider branch and supported per-call prompt override.

Validation: 69 service, route, script and preparation checks; real SQL regression flows for affordable inbound recording/playback/settlement, current SMS context, isolated configuration staging, and seller/buyer outbound recording plus conversation binding. Provider call audio still requires a real caller test after deployment.
