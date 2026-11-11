# Voice setup before dialing

The November 11 clarification concerns submission-to-ring delay, separate from response time during a call. Read-only receipts showed the immediate intake path already assigning and preparing the call; substantial time remained in setup before the durable dial claim. A recording's provider start timestamp includes later ringing/answer/connection work and must not be presented as the first-ring timestamp.

Independent reads now run together within bounded stages:

- Suppression, current seller consent and calling-hour context.
- Account identity, Run/Pause and existing conversation sender history.
- Current custom-voice selection, practice-agent exclusion and the operation rate.
- Saved SMS/call history, seller request and existing agreement context.
- Fresh exact reviewed agent, contract tool and recording-stop tool immediately before recorded-call admission.

All required results are awaited. Sender allocation, shared-learning assignment, credit reservation, dispatch claim, recording creation, dial claim and the single provider dial retain their original ordering. Provider reads remain fresh on every attempt; the approved agent/branch/version/hash, tool definitions, caller ID and custom-voice recheck are not cached or skipped. Final contact, calling-hour, Pause, funding, deadline and release checks still apply. A failed or ambiguous dial retains the original no-retry behavior. There are no UI, provider configuration, database schema or billing changes.

`live-dispatch.test.mjs` stalls each read group and proves every member starts before any finishes. Pending or failed groups cannot reserve, claim or send. `voice-dial-preflight.test.mjs` exercises the real recording service with deferred agent/tool reads, invalid and rejected responses, a release pause during reads and changed configuration on a later attempt. Existing recording admission/deadline, identity, contact, caller-ID and uncertain-result regressions remain required. All scenarios use fictional data without provider traffic.

This is a shorter serial setup path, not a measured live ring-time guarantee. No paid demonstration is part of the change. Release requires exact-head and exact-main Reliability checks plus the web and worker deployments for that main commit. A future explicitly authorized call can measure submission-to-dial and independently observed first ring.
