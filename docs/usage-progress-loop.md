# Usage progress loop

One inline card below the bot controls shows a verified recent result and one relevant next step. It replaces the previous funding-only banner and sits above Bot activity. Standard stays monochrome; a contextual VIP review action uses the existing gold treatment.

## Decisions

- A new account can receive a $10 starting suggestion only after identity, membership, payment and channel readiness are verified. The message does not claim a seller or task is waiting.
- Current unattempted, eligible seller/buyer SMS batches can justify a refill. When the bound prices are known, subtract the available balance and round the suggested additional purchase to $5, with the existing $10 minimum. A covered batch never solicits additional funds.
- A real eligible owner-enrichment candidate can receive a history-based suggestion; its unknown task estimate is not presented as an exact quote. Free screening, speculative discovery pages and unknown voice/email batches are not priced as pending work.
- Past manually selected amounts use actual credited amounts and exclude orders linked to automatic-recharge attempts. Opting into recharge during a manual checkout does not make that checkout automatic.
- Account review, setup outages, manual pause for a returning user, a recent purchase, healthy auto-recharge or missing recommendation data suppress automatic refill prompts. Existing manual funding, Pause/Run and payment authorization remain unchanged.
- A signed active deal can surface the existing VIP review. Reading or dismissing a card never changes membership, funds work, resumes the bot or enables recharge.

Progress uses completed active property research, provider-backed replies, completed live purchase agreements and independently confirmed closing records. Closing is not represented as proceeds received. Archived and practice properties cannot supply active progress or pending-work claims.

## Measurement

Two stable account variants compare wording only. A server-created observation is reused for 30 minutes; the browser reports shown only when the card is at least half visible. Click and dismissal reports are optional, deduplicated and account-bound. Analytics failure cannot block the card or its action. Preview event writes are disabled.

The admin Funding & progress section uses a fixed seven-day window for accounts first funded 30–7 days ago. It reports real first funding, completed property analysis, a second manual purchase, and charged usage on at least two Central calendar dates. These are overlapping milestones, not an invented sequential funnel. The owner account is excluded by default. Payments must match posted credit-ledger evidence; test payments and grants do not count. Prompt comparisons require complete seven-day follow-through windows and do not declare a causal winner or automatically rewrite policy.

No message content, names or contact details enter prompt observations. Records expire after 30 days in bounded maintenance batches. There is no external analytics vendor or paid model call for this feature.

## Verification

Focused local scenarios cover first funding, covered queued costs, pause/review/readiness, payment cooldown, auto-recharge, current account scope, stale responses, optional analytics, real payment evidence, practice/owner exclusions and retention. Browser checks cover mobile and desktop with intercepted fixtures. Production verification is read-only after applying the tested migrations; no development calls, messages, payments or auto-recharge are initiated.
