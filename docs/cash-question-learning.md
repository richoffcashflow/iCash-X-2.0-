# Cash-question learning

The cash-question-v6 SMS experiment now uses the existing evidence-v2 decision engine for new assignments. It tests only the three previously reviewed cash questions. A stable 20% account holdout continues balanced exploration; treatment gives a qualified winner at most 60% of property allocations and retains challengers. Unsafe arms are excluded; no safe arm means no new assignment. The evidence thresholds and contact permissions are unchanged.

An actual, source-bound provider dispatch starts a trial, including failed or unknown delivery. Each property contributes its first eligible exposure once. A positive still requires an exact approved delivered question and a direct affirmative from the same thread, backed by the original incoming event ID, body, phone pair and provider timestamp. The approved identity clarification can establish the same question when its saved job and actual output are bound to the preceding identity question. Unknown clocks, intervening questions, offer questions and conditional replies do not become positive labels.

Derived outcomes can now read original v6 assignments through the canonical SMS interest function used by targeting and the ranker. Original assignment times, copy, variants and allocation receipts are preserved. Historical balanced assignments never receive retrospective evidence-v2 decision or application records.

Interest and corresponding contact costs mature together after 72 hours. Recent costs do not dilute the mature outcome denominator. The shared seller contact reader includes bound follow-up SMS/AI, calls, inbound reception, seller email and revalidation costs; missing or ambiguous cost evidence prevents promotion. Its scope is explicitly `seller-contact-72h-v1`. It cannot qualify a contract or closing winner using 30/60-day outcomes and only 72-hour costs.

Direct seller refusals suppress positive labels. A minimal private receipt retains verified inbound call negatives after the original 30-day transcript retention expires. It stores source session, account/property/contact identity, time and disposition, without duplicating transcript content. Existing permanent contact opt-outs also remain authoritative. The newly installed seller-call reader uses these same source-bound negative receipts. These readers change learning evidence only.

## Installation and activation

Install the forward migrations in their generated order: seller contact cost learning, explicit cash-offer statement parser, continuous ranker evidence, then cash-question learning (`20261114182940`). The cash migration verifies exact predecessor function definitions and fails on drift. Its allocation gate starts disabled; original balanced allocation remains available.

After the exact commit passes canonical release CI and the existing global evidence-v2/SMS gates are activated for that registered release, the canonical owner can call `icash_activate_cash_question_learning(owner_uuid, release_sha, true)`. The release must complete after this migration was installed; the completion/activation clocks and global gate must agree. An older preinstallation SHA is rejected. The service-only `icash_seller_cash_learning_report()` exposes current evidence and the actual decision. Disabling with the same owner function serializes against assignments and restores the original balanced allocation for new work. Existing assignments and factual interpretation of already-sent messages remain intact.

Seller-call contact learning uses `icash_activate_seller_contact_learning(owner_uuid, release_sha, true)` and the same function with `false` for rollback. Its separate exact-release gate requires a canonical release completed after gate installation; an older preinstallation SHA cannot enable it. Enabling one experiment does not enable the other. No migration or local test initiates outreach, spends credits or grants new authority.

## Verification

`tests/cash-question-learning.test.mjs` installs the complete contact-cost migration, the actual parser patch and the cash migration against synthetic source receipts. It covers source clock/body/number binding, delayed old replies, identity clarification, failed dispatch denominators, missing costs, maturity, property deduplication, retained inbound negatives, immutable allocation proof, decisive winner allocation, challenger/control retention, safety holds and scoped cost promotion blocks.

`scripts/test-cash-question-learning-postgres.mjs` repeats the migration installation on a disposable native PostgreSQL database and checks concurrent assignment retries, assignment versus disable locking, single application records and immutable historical allocation. The database is fixed to local `icash_reliability`; no application credentials or paid providers are used.

These checks demonstrate the mechanics and guards. They do not claim that a seller-interest model or outbound variant has already improved in production.
