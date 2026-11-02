# Automatic seller clarification

Routine seller questions should advance the conversation without an operator interpreting each reply. `config/seller-dialogue.sql` extends the source-bound seller progression ledger and the existing message worker with nonbinding informational actions. The workflow remains accountable for actual dispatch and original provider receipts.

| Seller statement | Automatic next step |
| --- | --- |
| “No third parties” | Ask whether they mean agents or assignment to another buyer. |
| “No agents” / “What does assignment mean?” | Explain assignment and ask whether they would consider it. |
| “Yes” after that delivered explanation | Retain the seller preference and ask the next missing property question. |
| “Yes” after the either/or question | Explain assignment; this does not answer either/or. |
| “How much?” before ownership is established | Explain the dependency on property details and clarify ownership; do not mark ownership or consent. |
| Routine fees/process/price questions | Give a supported informational answer and continue missing qualification. No price is invented. |
| Request for a visit | Collect availability and access details, then require an actual attendee/time confirmation before booking. |
| Ordinary property answer initially classified as review | Continue the next missing qualification question when the exact seller source supports that fact and no independent hold exists. |

The SQL reads seller statements, exact quoted qualification evidence, customer messages and delivered questions across the thread. Direct-buyer restrictions remain real constraints. Seller willingness to consider assignment is neither purchasing capacity nor contractual authority. Existing offer, signature, title, customer negotiation and financial checks remain in force. A late customer message, newer seller source, changed account/route, takeover, pause, opt-out or expired checks prevents stale dispatch.

Fixed replies save an internal `seller_dialogue` action without purchasing another model analysis. The existing due-work issuer/resume path picks it up; final admission recomputes the exact response under current controls. Each source has one job and one outgoing operation. The full production campaign/message/financial guards are exercised in fixtures. There are no new provider endpoints or relaxed paid admission rules.

An answer arriving before the original clarification's delivery receipt waits on that receipt, with a one-minute retry trigger and a 15-minute uncertainty boundary. Receipt arrival resumes the next step without repeating the clarification or buying another analysis. A confirmed delivery failure, unresolved receipt after that boundary, or repeated unsuccessful clarification has a specific visible reason. No unknown operation is replayed.

`tests/seller-dialogue.test.mjs` covers multi-turn clarification, negation, ordinary questions, visit coordination, ownership, duplicate webhooks, late/missing/failed receipts, final-send mutation, source/account changes, human takeover, expired checks and no invented authority. `scripts/test-seller-progress-postgres.py` also runs 16 concurrent webhooks, recoveries and final claims against native PostgreSQL, with concurrent Pause. Existing regression tests retain the Floral City price conflict, historical Rockport/Memphis holds and human negotiation.

Install inactive (`dialogue_enabled=false`). Run exact-commit checks, native database tests, build and browser checks; deploy matching web and worker releases before enabling the flag under the budget lock. Do not reopen historical jobs, refresh consent, clear pauses or send demonstration messages. Roll back automatic preparation by disabling `dialogue_enabled`; original operations and receipts remain saved. This change improves seller SMS dialogue; it does not replace voice prompts, underwrite offers or grant signing authority.
