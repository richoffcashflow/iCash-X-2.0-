# Customer outcome visibility

The owner overview now shows customers and the owner's account in separate columns for signing, verified purchase contracts, buyer assignments, confirmed closings and proceeds. The usage account switch never combines these columns. An owner's live demonstration cannot appear as a customer success.

The report follows a signing cohort: live purchase-signing workflows created during the selected 1, 7 or 30 Central calendar days, through the current snapshot. It does not claim to be all historical contracts or a count of business events that occurred during the period. The existing closing-operations panel continues to show period activity and older open work. Test envelopes, practice deals and accounts funded only in payment test mode are excluded from the new cohort.

Purchase and assignment counts use the existing canonical provider/envelope/terms/recipient signature verifier. An optimistic deal stage or a completed envelope with mismatching proof is insufficient. Closing requires both agreements and verified title confirmation; proceeds additionally require the exact confirmed title disbursement, matching amount and the account holder's receipt confirmation. These are recorded receipts, not a bank-account reconciliation or platform income.

The new stable, invoker-security RPC has service-role-only execution and an explicit owner check. It reads at most the oldest 10,000 qualifying signing workflows after a 10,001-row overflow check. A truncated result is labelled partial and asks the operator to shorten the period. It returns aggregates only. No contacts, raw conversations, provider requests, record mutations, recovery attempts or wallet actions are part of this report. Optional evidence errors show unavailable rather than fabricated zero counts or failing the rest of the overview.

The existing cost-evidence panel already distinguishes estimated, verified and unclassified operation components and states that actual profit requires invoice and fee reconciliation. This change does not fabricate invoice data or relabel usage margin as company net profit. Learning qualification and model activation remain unchanged.

Apply `20261104140953_owner_deal_outcomes.sql` before the corresponding application release. A rollout with the RPC absent renders the explicit unavailable state. Rollback can remove the application view while retaining the read-only RPC; historical evidence never changes.

Verification covers actual signature matching, unsigned and wrong-terms rejections, customer/owner separation, test/practice and period exclusions, unverified/cross-account title evidence, wrong-actor or mismatching proceeds, private grants, the 10,000-row cap, route scope/period matching and unavailable/partial rendering. Production build and TypeScript pass. Offline browser verification covers desktop and mobile Chromium, the owner toggle, unavailable evidence and responsive layout. No paid development tests are involved.
