# Voice provider defaults — November 4, 2026

Ordinary outbound calls stopped before reservation or dialing with `production_agent_review_required`. Production logs identified `review_match / VOICE_AGENT_CONFIGURATION_MISMATCH`, rather than a failed provider read. The existing standing review and account rates remained enabled.

The immutable `outbound_config_review_20261010_8c0c60eee444` record captured two newly serialized defaults on the same reviewed version: `conversation_config.agent.prompt.built_in_tools.ask_teammate: null` and `platform_settings.app_connectors: {enabled: false}`. Its structural and exact seller-prompt checks passed. Comparison with the November 2 redacted snapshot found these two additions. Redacted snapshots do not establish equality of hidden fields; the live full-hash comparison remains authoritative.

The shared incoming/outgoing comparator can reconstruct the previous representation only when both exact inactive defaults occur together. It still requires the complete original saved fingerprint, unchanged identity, independently checked privacy/security, call controls, tools and offer guardrails. Partial, enabled, extended or malformed values are not normalized. No provider setting, approval, recipient permission, financial hold or previous receipt changes.

Offline regressions cover both incoming and outgoing fingerprints, composition with earlier observed defaults, frozen evidence, reverse refusal and substantive configuration drift. Existing comparison, configuration recovery, dispatch and readiness tests remain required. After matching production release, verify the canonical provider check and ordinary bounded recovery of never-admitted jobs. No paid demonstration or historical call replay is part of validation.
