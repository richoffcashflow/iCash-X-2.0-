# Title, customer proceeds and human takeover

The launch audit found no currently verified title contacts or qualified directory companies in production. Two researched directory candidates existed. A directory candidate, a buyer recommendation, email acceptance and an opened title file are distinct states.

The existing Buyers & closing panel now shows local directory candidates, the buyer's saved preference, a named closer and independently checked contact details. The owner can confirm a closer after verifying assignment handling, county coverage and agreement with the parties. An undecided title choice can be bound operationally without editing executed contract terms. A conflicting named closer, different recipient on an existing request or stale confirmation is rejected. Confirmation does not send documents or claim the title file is open.

The customer can save their legal payee name, individual/company status, and check pickup, mailed-check address or wire preference. Bank account/routing numbers, tax IDs and identity documents belong in the verified closer's secure intake process. The app has no fields for them. Unknown banking fields are rejected at the API and database boundary. A submitted-details checkbox is the customer's report, not a title confirmation or proof of payment. Editing details after title has reported disbursement is held for direct review.

The title opening request asks for required identity, tax and entity/signing-authority documents, secure intake, payee verification and disbursement arrangements. Saved payment preferences are sent only to the existing verified title recipient with the title request. They are not added to buyer packages or buyer AI facts. Existing spending, pause, recipient, signed-document and one-use delivery gates remain in place.

Signed deals create a visible setup task in Needs your review. A verified-sender reply reporting changed payment instructions, inability to accept the assignment or a title/legal issue creates a review item and holds property automation. Explicit buyer requests for a human also create the hold. The owner can take over; acknowledging a handoff does not resume work, place a call or schedule a callback. Only the owner's existing Return to bot action returns control. Already-started work may finish.

## Eight bounded local scenarios

| Scenario | Verified behavior |
| --- | --- |
| Buyer suggests an experienced local title company but lacks a contact | Save the preference, request independent verification, never auto-select or send. |
| No current directory coverage | Surface first-party human research; no paid lookup or invented partner. |
| Title is undecided, or someone tries to change an existing closer | Bind an owner-verified contact; reject conflicting named contacts, stale approval and wrong existing recipients; keep executed terms unchanged. |
| Customer wants a mailed check to a company | Require the legal payee and delivery address; ask title about entity/signing documents; keep preferences out of buyer data. |
| Customer wants a wire | Secure closer intake; reject banking fields and cross-account/actor changes; do not infer payment from saved details. |
| New wire details or title declines | Retain the original reply, require a person and hold property automation; an unverified sender cannot create a trusted title confirmation. |
| Buyer requests a human | Persist a visible handoff and hold new automation; owner acknowledgment does not fake a transfer; explicit return restores control. |
| Closing completes or title reports sending proceeds | Distinguish closing, sending and customer receipt; prevent silent changes to a reported payout. |

All eight scenarios run in an in-memory Postgres fixture. No provider clients, calls, messages, payment transactions or paid AI simulations are used. Additional focused checks cover the UI labels/forms, account-scoped activity pagination, the existing title-delivery one-use gate and the paid-simulation stop. TypeScript passes. The pre-existing workspace-view suite has a stale literal-copy assertion for “Blank is not $0” in unchanged contract-review-guide.tsx; this release does not change that unrelated contract copy.

## Remaining launch evidence

- An actual closer must be independently checked and accept the real deal. No partner has been invented or approved by this release.
- The real monitored title reply path and actual first title opening still need transaction-specific confirmation. No external email was sent during this work.
- A reviewed replacement assignment agreement must clear the existing privacy/signing hold. Required closing disclosures must be reviewed with the closer; buyer outreach cannot quote private acquisition pricing or the spread.
- The new buyer voice candidate remains disabled. Its prior provider acceptance run was interrupted for credits; local scenarios do not establish live voice quality or pacing. Paid simulations remain blocked.

Sources for the workflow, not a substitute for the assigned closer's deal-specific requirements:

- CFPB: independently verify wire instructions through a previously trusted phone number; do not email financial information. https://www.consumerfinance.gov/archive/blog/mortgage-closing-scams-how-protect-yourself-and-your-closing-funds/
- Old Republic Title's homeowner escrow checklist: identification and institution/routing/account information for proceeds wires; the escrow officer confirms the final net amount. https://media.oldrepublictitle.com/homeowners-manual/sacramento/files/basic-html/page17.html
