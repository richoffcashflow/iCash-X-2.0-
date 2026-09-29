# Preset bot setup

The guest homepage now asks for one required field: a name or business name. Saving opens the final setup and daily-budget page directly. Sarah, Onyx, nationwide search, contract templates and buyer matching are preset. An optional Customize panel lets visitors edit name, market, voice, color and included tools without going through separate screens. Changes are saved explicitly; Cancel discards the draft.

Logo generation is removed. POST /api/setup/logo returns 410 without starting an image job, including for old tabs. Existing artwork remains stored and its owner-protected GET route remains available. The UI uses a standard house icon, and contract previews use the saved name without generated artwork. No image-generation charges or polling are incurred by setup.

Existing saved preferences are retained. Older intermediate stages resume on the final page; saved setups reopen there. Profiles continue to accept legacy logo fields for backward compatibility, but the current flow saves aiLogo as null. No account, outreach, purchase, signature or property result is fabricated. Display names are not verified legal identities.

The final page preserves the daily slider, due-today amount, recurring-charge disclosure, explicit consent and ability to stop billing. Free setup does not start billing. Production readiness and contact-permission checks are unchanged.

Voice catalog data is fetched only after a visitor requests a preview. Preview audio is prerecorded and makes no phone call or synthesis request. Selecting a different preview does not silently change the saved voice. Rapid preview requests cancel stale playback.

Setup saves use revision checks to reject stale-tab writes. The guest cookie is HttpOnly and account isolation is unchanged. Name and completion events come from saved data; purchases still require actual settled orders. New setups are no longer randomized into the guided-vs-quick test. Historical cohorts are preserved, but that retired experiment must not be used to claim a conversion improvement after this rollout because all visitors now receive the preset UI.

Validation: TypeScript; profile, default and legacy-session resume tests. Browser verification follows the deployed release without funding or outreach.
