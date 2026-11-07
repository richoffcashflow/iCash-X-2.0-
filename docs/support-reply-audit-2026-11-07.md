# Support review — November 7, 2026

Reviewed the preceding seven days of saved support activity: 59 account conversations and 10 sign-in conversations, containing 1,283 messages. Recent conversations received a detailed current-step review; the full set was checked for recurring quality signals. A flag is a review aid, not proof of a current bug. Some older failures were already covered by prior releases.

Only generalized scenarios and offline fixtures belong in this repository. Private transcripts, customer identifiers, account metrics and payment details are excluded.

## Reply corrections

- Manual seller contact now explains Take over, Call/Texts and Return to bot instead of answering when contact details appear. Takeover persists; there is no daily automatic handback.
- Follow-up answers no longer promise contacting every seller every day until a response. Unanswered cold seller texts allow at most one eligible follow-up 3–5 days later; active conversations and requested callbacks have separate timing.
- Unanswered-call questions use recorded call attempts and the relevant call outcome. Text deliveries and text replies do not establish how many people answered calls.
- Seller legal-name fields are editable. Every required seller signs the purchase agreement before the customer's Review & sign step. Buyer assignments remain a distinct flow, and exact-agreement auto-sign authority is separate.
- Buyer network guidance explains the workspace panel's active-deal/response visibility condition, rather than promising that VIP alone exposes an empty directory. Automatic market selection, weekend work, draft pricing and older-lead filters use current product behavior without invented arrival times.
- A Review control that opens nothing remains a reported software issue. A resolution note does not restart blocked follow-up or renew contact checks.
- Sign-in troubleshooting accepts payment date and amount from a statement when no receipt arrived, preserves details already supplied and trusted operator findings, and avoids classifying those details as a credit purchase. A new substantive topic still changes the response.
- Management-review follow-ups explain the unresolved issue and where replies can appear, without an invented fix, completion time or promised phone call. A later unrelated question is not automatically pulled back into the old review.

Known current-step cases use deterministic replies before optional model generation. Source-conflict checks also flag daily-until-answer promises and claims that editable seller-name fields cannot be entered manually.

## Case review

Five account cases were marked escalated, including one previously resolved and one previously closed despite unresolved complaints. Two open sign-in cases were marked for operator review. Updates required unchanged prior status, timestamp and latest-message identity; read-back confirmed all seven. No customer messages were sent and no historical message was changed.

These queue changes do not establish that an underlying access, payment, outreach or UI complaint is fixed. Those cases still need their own verified findings. The reply update has no database migration, provider configuration or billing prerequisite.

## Validation and release

The new offline suite covers 41 anonymized multi-turn reply replays plus intent boundaries and quality-report checks. It asserts that known cases make no external model request. Existing support/access suites, TypeScript and the production build are checked alongside the complete repository test suite. The new suite is registered with local release verification.

Release follows the owner's standing automatic-release process: the latest canonical Reliability checks must pass for the exact PR head, then the exact main-push checks and production deployment must be verified. An open PR or queued build is not a live release. No paid simulations, retrospective replies, account ownership changes or outreach actions are part of this review.
