# Clear seller-call identity

A saved seller call repeated its ownership question after “Hello?”, answered “Who is this?” with “I'm a cash buyer”, then requested the person's name. The historical automatic-offer prompt contained that cash-buyer fallback even though the assistant's role was AI. The caller's final do-not-call request was correctly saved as an opt-out and blocked callbacks.

## Runtime correction

- Remove the conflicting `BUYER IDENTITY` paragraph from per-call automatic seller instructions. Keep the historical provider prompts and their review hashes unchanged.
- Answer identity questions with the AI role and saved principal/company. Do not invent a company from a personal principal. Omit absent assistant names; if no buyer identity is available, explain that it cannot be verified.
- Answer before qualification or tools. A greeting is not ownership confirmation, and declining a question is not permission to ask for the person's name instead. Reuse answers rather than repeat the owner question.
- Explicit opt-outs take priority over questions and callback requests. Acknowledge, use the existing available opt-out tool, then end. Do not claim a suppression succeeded without a successful result. Ordinary refusals end the pitch without inventing permanent suppression.

The correction runs in automatic outbound seller prompt assembly and the existing matched-seller inbound role-instruction slot. Buyer, unknown-caller, cancellation, instant-lead and nonautomatic seller paths retain their existing policies. Recording disclosure, contact admission, customer Pause, financial/offer authority and provider tools remain unchanged. No SQL migration or provider configuration write is needed. Production web and worker releases must match before calling it live.

## Offline verification

`seller-caller-identity.test.mjs` checks all historical automatic seller variants, idempotent removal, sanitized inbound company-only and missing-identity contexts, unchanged buyer/unknown roles, and an anonymized saved-transcript opt-out replay. The actual dispatcher regression checks v9 fallback removal, bound identity, the unchanged 24,000-character limit and retained whole historical answers. Existing recorded-reception and buyer-policy tests check adjacent flows.

These tests validate instruction composition and deterministic result handling. They are not model-response or audio-quality evaluations. No test calls to people, paid provider simulations, historical replay or live suppression changes are part of this repair. Observe future ordinary permitted calls separately without retrying the opted-out contact.
