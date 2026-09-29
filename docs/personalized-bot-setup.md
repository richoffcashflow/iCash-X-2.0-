# Personalized bot setup

The guest homepage is a four-step, single-page flow: display name, color/logo, voice, and preferred market. The balance and funding widget are absent until the last step. Setup is free and the entry states that running uses a paid daily budget. Names generate three deterministic logo styles without image-generation API charges. Mobile shows one capability per step; desktop displays the full capability preview. No messages, signatures, properties or earnings are fabricated.

Setup is saved server-side after each step behind a random HttpOnly guest capability shared with funding. Revisions reject stale-tab writes. After a paid order is verified and claimed, the setup attaches to that account. Signing out rotates an already-claimed guest capability on the next setup, preventing account-profile disclosure. Setup name is a display name, not a legal principal or signature. Existing verified identity capture remains required for contracts. Market preference is saved; an approved market/ZIP mapping is still required before live acquisition. No property counts are invented or reused from other tenants.

Three premade ElevenLabs voice previews are selected from the provider catalog, cached for a day, and played only on tap. No TTS synthesis or phone calls occur during preview. The saved voice preference is used when saving verified identity. Live voice dispatch uses that voice if it matches the agent default or is in the reviewed approved_voice_ids list; otherwise it holds rather than silently using a different voice. Provider Voice ID overrides also must be enabled by the production configuration process. No production configuration is enabled here.

Guest returns resume at the last completed stage; completed setups open funding. Existing funded accounts retain their workspace. Stripe’s daily budget and explicit renewal consent are unchanged. Free setup never starts billing.

Funnel events are deduplicated per setup and step. Names are stored in the setup profile, not analytics payloads. Server saves produce completion events; real settled live orders produce purchase metrics. The private icash_setup_funnel_report() reports mature 24-hour cohorts over the last 31 days, including each completed step, checkout opens, buyers and gross purchase revenue. This is conversion/revenue reporting, not profit or Meta attribution. Fresh cohorts are excluded to avoid premature drop-off conclusions.

Two reviewed CTA texts start evenly randomized. After at least 200 mature visitors per version and separation of approximate two-standard-error purchase-rate bounds, new sessions favor the leader 80/20. Assignment never changes mid-setup. This is a bounded allocation heuristic, not autonomous UI rewriting or a proven statistical improvement. It cannot change prices, billing consent, or operational controls.

Production verification: all four saves and restore-to-funding passed against the deployed API; all three provider preview URLs were returned. TypeScript and rollback database checks passed. The local browser renderer could not run because the environment denied its socket; mobile visual verification remains outstanding. Conversion allocation is cached for 15 minutes with indexed cohort lookups.


## Business-builder update
- Removed the duplicate preview card; all steps use one centered form.
- Server-side AI generates three validated vector logo choices, with saved results and initials fallback. Provider names are omitted from customer setup. No generated image asset is required.
- Model usage is stored with each logo job. Maximum 100 attempts globally per UTC day, two per setup (only on a changed name), plus request limits. Duplicate requests never regenerate. Failed/stale requests use the initials fallback. These are free acquisition costs, not customer credit charges.
- Contract and buyer preferences default on and are saved in the setup profile. They express selected setup preferences; they do not independently enable production outreach.
- Branded seller and buyer template previews reuse the existing document renderer, leave legal parties and deal terms blank, and remain clearly unsigned drafts. Display name is never substituted for verified legal identity.
- Funding remains last, with paid usage disclosed before setup. No fake market research, property counts, messages, signed contracts or profits are shown.
- Validation: TypeScript, schema/XSS tests, rollback DB claim/dedup/access checks. Browser visual verification remains unavailable in this execution environment.
