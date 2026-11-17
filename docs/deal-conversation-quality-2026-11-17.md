# Seller, buyer and title interpretation

This change fixes four independently reproduced interpretation and data-loss
problems without changing the workspace layout, money rules or contact authority.

- Seller qualification reuses the existing canonical interest vocabulary. An
  unambiguous answer such as “I'm interested” to a selling question is retained
  across voice/text context; it does not establish ownership, an accepted price
  or agreement permission. Refusals, changed speakers and ambiguous replies keep
  their existing boundaries.
- A future or hypothetical agent listing remains unknown. “It will be listed
  with an agent” must not establish a current listing and end qualification.
  Genuine current listing confirmations and explicit negative answers remain
  available.
- Buyer discovery retains contact observations from repeated rows for the same
  exact provider owner. It still produces one prospect with the original property
  binding. Original phone observations are separate from effective phones: a DNC
  flag wins, and an unknown observation prevents a false clearance for the same
  normalized number. The current legacy SQL consumers are exercised in tests.
  Observations are not permission, qualification or proof of an active buyer.
- Title review suggestions distinguish requests for verification from completed
  milestones, retain abbreviated dates, and avoid prefilling contradicted or
  reversed deposits, wires, dates and references. Incomplete long source text
  yields no suggestion. These are review suggestions; they never record a
  signature, deposit, closing or funds receipt.

## Validation and release

Each defect was reproduced against the prior source. Fictional regression cases
cover both seller channels and the bound return-call service, buyer discovery
and conflicting restrictions in both source orders, and title/closing evidence.
Independent review caught and corrected a buyer restriction regression and extra
hypothetical-listing and verification-request cases. Focused suites and full
TypeScript pass. The new seller suite is registered in local release checks;
the other expanded suites were already registered.

No database migration, provider configuration or feature activation is required.
Use the ordinary exact-head checks, serialized expected-head merge, exact-main
checks and web/worker verification. An open PR or passing offline scenarios do
not establish production release or improved conversion. Customer activity is
not replayed to validate these changes.

The separate current-production review also identified seller pause-choice,
callback and ownership-question routing gaps. Those require their own source-
pinned database and connected-path changes; this patch does not claim to fix
them. Existing queued agreement, carrier, voicemail and scheduling work retains
its own prerequisites and ownership. Shared seller memory rollout and actual
customer signature-to-closing outcomes require separate production evidence.
