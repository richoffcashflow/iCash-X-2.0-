# Seller payoff corrections by text

The November 17 audit reproduced one conversion defect through the actual text
planner, SQL save/final admission and service fixtures. At a $90,000 proposal, a
seller reported a $100,000 mortgage, no other debt, and declined the $10,000
difference. After the seller corrected the mortgage to $95,000, the old code
repeated “Would you like a person to review any other options?” instead of asking
about the new $5,000 difference. The same merge retained earlier positive
coverage when a reported balance changed.

The SMS update now follows the existing call update: a source-backed change to
either mortgage or other debt removes the prior shortfall acceptance/decline
from current authority. It preserves the unchanged other balance, original
accepted lower purchase price, server ceiling and original messages. An
unchanged balance, same-source replay, purpose question or unparsable answer
does not fabricate a new balance or erase the saved coverage report. Missing,
duplicate or mismatched canonical sources still require reconciliation.

This changes only the current projected offer state. It does not rewrite
historical debt statements, coverage questions, refusals or delivery receipts.
For a remaining shortfall, the bot asks the current exact difference, then
requires fresh coverage and price confirmation. Existing identity, ownership,
date, inspection, exact terms/text authorization, final admission and one-use
agreement checks remain in place. Seller-reported debt is not title verification.

Offline validation:

- `tests/seller-text-offer.test.mjs`: the original failure was the expected
  `$5,000` question receiving the old human-review question. The corrected
  journey now persists cleared old coverage, accepts the fresh $5,000 answer,
  confirms the exact $90,000 price and terms, and creates one mocked agreement.
  A second saved-state journey retains an accepted $60,000 instead of raising
  it to the $90,000 ceiling, invalidates old positive coverage and blocks an
  agreement until renewed authority. Duplicate processing creates no dispatch.
- `tests/seller-text-payoff-revision.test.mjs`: canonical-source mortgage and
  other-debt changes, explicit zero, increases/decreases, positive/negative old
  coverage, unchanged reports, replay, interruption and fresh exact answers.
- Existing voice payoff, automatic offer and text price-authority suites protect
  parity and independent price/source controls.

No provider, model, audio or hosted action was used. These checks establish
deterministic progression and evidence preservation, not live conversion rates,
phone quality, production rollout or competitive performance.

Separate audit follow-up: the existing same-body SMS repetition limit also counts
fresh price confirmations after successive payoff updates. A seller who has
already received two identical price questions can reach `seller_answer_unclear`
on a later valid confirmation step. This patch does not change that limit.
