# Support audit — November 5, 2026

This change addresses recurring support-routing failures and two related product defects. Only generalized examples and offline fixtures are included; customer identifiers, private transcripts and production account metrics are excluded.

## Confirmed reply failures

- “Do you know why no one is answering?” was treated as an account-identity question. Funding questions were treated as manual lead imports or paid coaching.
- Mentioning refunds could suppress a simultaneous voicemail-count, market and usage complaint. New guidance answers those issues together and preserves unresolved status.
- Support claimed manual control ended the next morning. Takeover and manual texting persist until Return to bot; Run and the existing signature/check requirements still apply. “I’m in control of this lead” is not sign-in success.
- Browser calls connect the customer’s microphone; they are separate from automatic AI calls and saved-recording playback.
- Agreement failures and truncated recordings need the failed step or exact call, not a generic feature explanation or a claim that the behavior is normal.
- Credit timing, lead counts, buyer work costs, automatic markets, title coordination, potential assignment fees and stock voice selection now use actual product behavior. Dollar-denominated ARV questions no longer become credit-purchase guidance.
- Guest replies now distinguish missing receipt, missing code and missing workspace access; sign-in navigation includes the official site. Waiting-time/scam follow-ups preserve the access issue without an invented deadline or another purchase.
- Opportunity progress follows the selected calendar period. Support no longer attributes an unexplained reset to changing markets. The existing funding-independent reporting and failed-refresh preservation tests passed. This does not prove every historical display failure is resolved.

## Product fixes

Seller follow-up requests now offer **Open conversation**, which opens the matching property's Texts dialog and Calls tab, including properties outside the current page. Existing manual-send, signature, account and resolution-save behavior remains unchanged.

The response predicate missed “When you have finished recording…”, brief-message and sound-of-the-tone variants, plus a fragmented beep greeting followed by a canonical mailbox prompt. The TypeScript ingestion classifier and PostgreSQL predicate now agree on those variants. The SQL patch preserves the fast CASE branch already installed for the admin outreach repair (#578), source-word opt-outs and the original function permissions. It invalidates only derived outcome-refresh timestamps.

Read-only comparison with saved source transcripts verified the additional exclusions are automated recordings. A human refusal still counts as a response; a response does not establish selling interest. Original transcripts, provider receipts, costs, balances and control settings remain unchanged.

## Verification and release

- 32 support suites pass, including 44 new anonymized reply replays and intent boundaries.
- SQL/TypeScript parity covers 25 individual turns, mixed machine/human calls, source opt-outs, unchanged transcripts, false-interest/callback guards and both original/optimized SQL predecessors. Unknown or repeated migration predecessors fail closed.
- Desktop/mobile Chromium checks cover conversation navigation, narrow layouts, text enlargement and failed/successful resolution saves. An off-page conversation scenario is included.
- TypeScript, the production build and complete local release checks passed. The newly merged contract-delivery suite was checked separately. Canonical exact-head/main CI remains required before production application release.

The guarded migration was installed at 07:29 UTC as `20261105072921_seller_voicemail_response_variants`. Read-back returned definition hash `0f0fa0dd3cb62bfa0b40d4e9a9dee7a6`, confirmed the fast CASE branch, and confirmed the corrected response predicate. Security advisors show only the pre-existing informational notice. The web and worker must run the matching released source before claiming the runtime classification fix is fully live. Preserve the separate admin-report, VIP-banner, course and contract-delivery releases.

## Still requires case-specific evidence

An account with dispatched operations but incomplete final cost receipts still needs reconciliation; held commitments are not available spending money. This change does not clear those holds, manufacture zero costs, unpause customers or claim every historical report is repaired. Paid-access claims and disputed deductions require their own matched records.

No retrospective customer replies, seller messages, paid simulations or billing changes were made. Release uses the owner's standing automatic-release process. If rollback is necessary, reverse only the exact predicate fragment after checking the current function, preserve #578's fast path, and refresh derived outcomes; do not replace raw conversations or restore an obsolete whole function.
