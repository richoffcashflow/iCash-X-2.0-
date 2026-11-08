# Custom voice playback support

On November 7 Central, the owner reported a support complaint about hearing a custom voice. Read-only production inspection confirmed that the affected account had active VIP and a ready, enabled clone, but both preview attempts received provider HTTP 401 and saved no audio. The full preview table contained 25 rejected attempts across 13 accounts, all HTTP 401, with no saved provider history IDs. This establishes failed authorization for preview requests, not the exact missing key permission or a failure of live calls. The original rejection bodies were not retained.

Support incorrectly said custom-voice playback was unsupported, then inferred that a lack of seller feedback meant the voice was probably not scaring sellers away. The shipped UI already includes Customize bot → Custom voice → Play my cloned voice. Deployment alone did not establish working audio generation.

## This correction

Use deterministic answers for custom-voice playback and its immediate troubleshooting/quality follow-ups. Give the actual VIP/ready-clone control, keep failures open for management review, correct earlier false feature denials, and avoid unsupported judgments about voice quality or seller reactions. Explain Use standard voice when asked, without changing the user's selection. Preserve separate seller-call playback, browser calling, guest access, billing and other new-topic paths. Add the controls and limits to the shared product guide and flag the observed false claims in the existing support-quality report.

Anonymized offline replays cover the three-turn complaint, missing controls, supplied error text, no sound, active/inactive/unknown VIP, topic changes, actual resolution, ordinary call recording boundaries and the shared model/recovery path. No customer message, provider request, audio generation, live voice selection, customer charge or saved rejection is changed.

## Separate operational blocker

This support-code release does not repair the provider authorization failure. The configured voice-provider connection needs an authenticated permission/credential check; text-to-speech permission is a required preview dependency. Preserve all original attempts and unknown outcomes. Three accounts had exhausted the existing three rejected attempts; they need a separately reviewed recovery after the connection is verified. Do not reset counters or regenerate uncertain requests. A successful deployment is not proof that customers can hear a preview. Verify actual saved audio from an authorized customer action after the provider repair; paid development demonstrations remain disabled.

This code correction has no database or provider-configuration prerequisite and can release independently under the normal exact-head/exact-main Reliability and production checks. Keep the operational playback incident unresolved until there is source-backed successful playback evidence.
