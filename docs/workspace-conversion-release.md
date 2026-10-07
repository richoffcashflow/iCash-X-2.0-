# Contextual workspace conversion

The signed-in workspace asks for one next action from current server records:

- Low credits: suggest a personalized one-time refill, using the median of the last five manually chosen, confirmed deposits in 30 days. Recent settled usage and available balance can justify a higher suggestion; new users start at the $10 minimum. The low-balance threshold is 20% of their usual refill, with a $5 floor. Queued-research wording requires an actual queued research record; completed-research wording requires a completed record. Otherwise describe what credits fund without claiming work is waiting.
- Funded and paused: offer to run the bot using the existing work-control authorization.
- Funded and running on eligible Standard membership: open the existing VIP review directly. Suppress this offer for 24 hours after confirmed funding and for existing VIP users.
- Hide recommendations for stale account data, billing review, inactive subscriptions, unfinished identity/setup, or open checkout/settings. Enabled, healthy auto-recharge suppresses refill prompts; a recharge issue allows manual funding again.
- Dismissal minimizes the same offer for the rest of the mounted workspace session. No blocking or timed sales popup.

Funding remains an explicit payment. The suggested amount opens selected, can be changed, and uses the existing authenticated Stripe customer. Embedded Stripe is used when a matching publishable key is configured; hosted Stripe remains the fallback. Retries reuse the pending owned checkout. The UI waits for exact-session settlement before refreshing the account; historical purchases cannot confirm a new purchase. Confirmed settlement continues using the existing automatic activation and 50% daily allowance logic. Auto-recharge remains unchecked until chosen.

The engine does not create billable work, increase budgets, automatically upgrade plans, send marketing messages, or infer income. Reading a recommendation never makes a payment request.

## Validation

- Production build and TypeScript pass.
- Ten focused test files cover conversion priority, authenticated account scope, stale response suppression, minimized reminders, explicit payment, exact amount, inline checkout, delayed confirmation, pending-session reuse, VIP payment/renewal, and auto-recharge consent.
- Live read-only queries verified research states, recharge fields, available credit packs and VIP schema.
- Browser automation was attempted but the environment could not download a usable Chromium executable. No live customer payment was made during verification.
