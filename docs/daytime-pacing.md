# Daytime seller budget pacing

New seller calls use gradual cumulative daily budget admission in the recipient's verified timezone, within 09:00–20:00 and any narrower saved contact hours. One hour of budget headroom is available at the start so the day can begin. Unused capacity carries forward within the day; this is a ceiling, not a requirement to spend. The existing rolling 24-hour customer limit, available balance, company reserve, permissions, Pause and cost/margin controls still apply.

After at least 30 completed first-contact seller calls per local hour, the account's own last 90 days of recorded seller-interest outcomes tilt hourly weights between 0.5x and 1.5x. Weekdays and weekends are separate and timezones must match. Below this threshold weights are even; there is no invented claim about a universal best calling hour. This is a bounded observational heuristic, not proof of causal lift. No cross-tenant conversation data is used.

If callbacks or deals under contract are active, preserve 20% of the daily budget from new cold calls. Callback calls, buyer calls and ongoing SMS replies bypass this new prospecting pace limit, while retaining their existing limits. A paced-out call returns to ready with a 30-minute due time; it does not claim dispatch or retry an unknown provider outcome. Admission and reservation share the company-ledger lock to prevent concurrent overspend. Existing reservations are counted.

No funding delay was added, and no Stripe payout is assumed complete. Production operating funds remain unchanged. No live calls were made. Rolled-back tests verify local opening/closing hours, daylight saving, gradual allowance, active-deal headroom and account isolation; TypeScript validation passes.
