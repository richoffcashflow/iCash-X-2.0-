# VIP custom voice

VIP includes one private Instant Voice Clone for outbound seller and buyer calls. Settings → VIP → Your voice accepts a clear recording of the account owner's own voice, with an explicit authorization checkbox. MP3/M4A/WAV/WebM files are bounded to 4 MB before multipart parsing and checked for audio signatures. The browser can play the source recording before upload. Samples go directly through the authenticated server to ElevenLabs and are not kept in app storage.

The server creates a durable account-bound job before uploading. Repeated submissions reuse that job. A provider timeout stays unknown and is reconciled by the exact server-generated voice name; it never blindly creates a second clone. Provider-required verification blocks activation. Ready voices can be enabled or switched back to the standard voice. The stored standard identity is unchanged, and VIP expiry automatically selects it again. Provider metadata is checked before dispatch; no global shared agent or voice allowlist is changed.

Shared inbound reception retains its existing voice. It does not have account-specific voice overrides enabled, so this release does not advertise custom voice on inbound calls. Cloning does not change the call's model, prompts, prices, duration, or existing calling controls.

Deployment order: apply config/vip-custom-voice.sql, verify service-only function privileges and table RLS, then deploy the app. Uses the existing ELEVENLABS_API_KEY with voices read/write capability and an available Instant Voice Cloning slot. Permission/quota/provider failures leave the standard voice available and report setup failure. No live voice clone or call is created without an owner's uploaded sample.

Verification: provider adapter tests cover consent, duplicate upload, ambiguous timeout recovery, provider verification and account binding. Actual SQL tests cover ownership, VIP expiry, enable/disable and privileges. Existing call dispatch tests exercise the selected custom voice while retaining call readiness checks. A real uploaded recording is still required to assess clone quality and confirm provider provisioning end to end.

Provider documentation checked October 7, 2026: https://elevenlabs.io/docs/api-reference/voices/ivc/create and https://elevenlabs.io/docs/api-reference/voices/get
