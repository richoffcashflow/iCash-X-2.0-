# Custom voice preview

VIP customers can open **Customize bot → Custom voice → Play my cloned voice** once their clone is ready. The first click creates one fixed, short sample with the cloned voice; successful audio is stored privately and reused across replays, devices and sessions. The preview works with a zero credit balance and a paused bot, and never changes the live voice selection. Standard accounts do not receive this VIP control.

The owner approved covering the initial generation as a platform expense on November 4, 2026. This does not permit paid development demonstrations. No customer-wallet reservation, charge, call, message, top-up or auto-recharge occurs in this flow. Provider character-cost and request/history identifiers are retained when returned; absent costs remain unknown.

## Request and storage

`GET /api/account/custom-voice/preview` is authenticated, VIP-authorized, read-only playback. It never contacts the voice provider. `POST` requires the same account authorization and a permitted origin, accepts no body or client-supplied voice/text, and limits repeated clicks. The server verifies the private clone against the existing account/verification rules, then atomically claims the exact voice in `icash_begin_custom_voice_preview`.

The separate `icash_custom_voice_previews` table holds bounded MP3 audio and request receipts. RLS is enabled; anonymous/authenticated database roles cannot read the table or call the claim RPC. The HTTP handler derives the account from the sign-in and returns audio with `private, no-store`. The browser revokes its temporary audio URL on unmount or lost voice access. The original uploaded recording remains separately labeled.

Concurrent clicks produce one claim. Successful audio never regenerates. A timed-out, interrupted or unknown provider request never retries. If its exact history item was saved before an audio/storage failure, a later Play click can recover that audio by GET without generating it again. Explicit provider rejections without a history item can have at most three total attempts, at least a minute apart; each original attempt is retained. Expiry alone never clears an uncertain generation. The UI polls only read-only status while another request is preparing the sample.

## Validation and release

- `tests/custom-voice-preview.test.mjs` executes the service and route against the actual SQL in PGlite with offline provider fixtures: zero credits, Pause, VIP/tenant boundaries, fixed text, no live-voice changes, immutable unknowns, exact history recovery, rejected-attempt limits, audio size/type, and private database access.
- `scripts/test-custom-voice-preview-postgres.py` runs 24 native PostgreSQL contenders in the Reliability checks job and checks late VIP removal under the original account lock.
- `tests/custom-voice-preview-browser.mjs` exercises desktop/mobile playback using a locally generated tone, cached replay/reopen, concurrent preparation and VIP visibility. No customer recording or paid provider test is used.
- Existing custom-voice selection and inbound/outbound fixtures remain unchanged; playback calls neither call dispatcher.

Install the additive migration `20261105042311_custom_voice_preview.sql` before releasing the endpoint, verify its service-only ACLs, then use the normal exact-commit Reliability/production gates. The existing ElevenLabs connection needs text-to-speech permission; exact-history recovery additionally uses its history read permission. A missing provider permission produces a recoverable rejection, without touching calls or customer funds. There is no provider billing-plan or overage change.

Rollback is the ordinary code rollback. Retain preview records and provider receipts; do not clear claims to force regeneration.
