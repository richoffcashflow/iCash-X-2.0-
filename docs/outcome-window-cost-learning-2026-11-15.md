# Outcome-window customer cost learning

The seller-call and reviewed cash-question experiments can compare verified contracts per customer dollar after 30 days, and verified closings per customer dollar after 60 days. The existing 72-hour selling-interest comparison stays separate. This release does not create outcomes, reset assignments, change prompts, or force a winner.

Each mature trial includes its original property acquisition costs and all source-bound seller, buyer, signing and title operations through the same outcome horizon. Negative trials stay in both the outcome count and cost denominator. Every account uses the existing contribution weight; the score's opt-out penalty is drawn from that same mature trial set. The broader opt-out safety guard still runs before scoring. A shared decision still requires the existing account/sample/confidence thresholds, retains the stable control cohort, and gives a qualified winner at most the existing allocation share.

## Evidence and accounting

| Source | Attribution |
| --- | --- |
| Discovery page | Original same-account result and immutable returned-property receipt must agree. Divide settled net cents equally across all distinct returned IDs, sorted by ID, assigning the remainder in that order. Include IDs that were filtered, already present or never queued. The shares sum to the original page charge and do not depend on outcomes. |
| Owner lookup or shared owner batch | Use the original property operation and original validated owner receipt. Batch allocation already settled into individual property operations is not divided again. Failed admitted operations remain visible. |
| Inbound acquired lead | Use the original seller-match operation and matching screening/source identity. Shared refresh costs without property settlement remain incomplete. |
| Seller and buyer contact | Original message, AI job, recording, live session, permission/contact job, customer phone call and exact inbound binding connect to the current same-account property. Duplicate observations of one operation count once. Phone matching alone does not prove attribution. |
| Signing and deal email | Count all non-test signing operations and original outgoing deal emails, including buyer and title correspondence. Unpriced legacy signing-provider SMS resends are explicit gaps. |
| Buyer discovery | Original saved deal receipt or exact admitted original buyer-search request connects unknown attempts to the owned deal. |
| Title | Original requests, follow-ups/document updates and historical saved search receipts bind to the deal. New qualification jobs record their first triggering deal as immutable full-cost owner. Exact later reuse records no second operation; legacy missing ownership stays incomplete. |

The cost numerator is actual settled customer usage, after matching platform coverage. A positive gross charge requires its single matching negative usage ledger entry. Coverage requires both its same-account conservation record and matching grant ledger entry. An explicit zero requires an original settled operation and settlement evidence; absence of billing evidence is never interpreted as zero. Shared page rounding conserves net customer cents and separately conserves available supplier micros.

Supplier cost and supplier completeness are reported separately. Estimated supplier cost cannot become verified supplier economics, but it does not erase independently proven customer usage. These comparisons are neither profit nor revenue metrics.

An operation attributed to conflicting properties, inconsistent allocation ranks, missing original discovery evidence, incomplete coverage, ambiguous inbound sessions, legacy title work or unbound paid work prevents a complete affected window. Unknown account acquisition costs are retained as gaps; they are never assigned to a guessed successful property. Original dispatch time starts acquisition accounting, even when result ingestion and screening creation happen later. Late settlement can complete original work without changing its dispatch window.

## Installation and activation

The generated migration composes these reviewed configuration files in this order inside one transaction:

1. `config/outcome-title-cost-attribution.sql`
2. `config/outcome-cost-sources.sql`
3. `config/outcome-window-cost-collector.sql`
4. `config/outcome-window-cost-learning.sql`

The existing seller-call and V6 refresh functions consume the collector, and the canonical shared statistics expose separate 30/60-day weighted denominators under `property-outcome-costs-v1`. SQL and TypeScript use the cost window corresponding to the selected mature objective. Old 72-hour cost receipts are not relabeled.

A subsequent read-only production check found a concrete planning problem before activation: the SQL-language source function's generic plan estimated one valid screening for an account containing 2,685 valid screenings and timed out at eight seconds. The exact source SELECT planned for that account completed in 1.70–3.05 seconds and returned 7,433 rows. Production reported JIT off and no LLVM support; disabling JIT did not fix the generic-plan timeout.

The separate `config/outcome-cost-source-planning.sql` forward migration therefore changes only the private source function to stable PL/pgSQL with `RETURN QUERY EXECUTE ... USING p_account`. The inner SELECT is byte-for-byte the original query except that the typed account parameter is `$1`; no identifier or customer data is interpolated. This plans each account separately while preserving the original predicates, rows, ordering, return schema, empty search path and service-only privileges. The already-installed original migration stays immutable. Install this guarded correction before activating outcome collection.

The native regression `scripts/test-outcome-source-planning-postgres.mjs` reproduces the account-size imbalance with 599 small accounts and one account containing 2,691 screenings, 768 saved owner receipts, 725 voice jobs and 205 complete inventory pages. The original function took 3.67 seconds and the corrected function 1.38 seconds; both returned the same 4,633 rows, with zero differences in either `EXCEPT ALL` direction. This also exercises actual owner batches, receipt validators and permissions. The full consumer and batch tests run against the corrected function. Before activation, separately verify a normal production function call under the bounded timeout; local timings are not a production guarantee.

Collection and qualification install disabled. After a successful canonical post-install release is registered and the existing global learning policy is activated for that exact release, the owner can enable `icash_activate_outcome_cost_learning`. A changed/disabled release immediately prevents qualification and collection. Existing 72-hour observations continue to refresh. The new collector batches an account's mature trial windows against one materialized source graph; disabled refreshes pass an empty batch and do not scan that graph. Per-window and account graph caps fail closed.

The global release and its existing seller-contact and cash-question gates must move together. After the exact-main Reliability receipt is registered through the existing canonical release process and the web/worker deployment is verified, use the following single transaction with the verified SHA. The saved active predicates preserve which prior scopes were enabled; the cutover invalidates only derived rollups and queues their recomputation. It deliberately does not reset ranker samples, model, export rotation or training lease because this release changes neither their labels nor their features.

```sql
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $cutover$
declare
 actor constant uuid:='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
 release text:='EXACT_VERIFIED_MAIN_SHA';
 seller_enabled boolean;cash_enabled boolean;sms_enabled boolean;
 global_enabled boolean;current_release text;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 for update;
 select enabled,release_sha into global_enabled,current_release
  from icash_learning_policy_private.settings where id=1 for update;
 if global_enabled is distinct from true then
  raise exception 'Global learning was paused; preserve the operator control';
 end if;
 if current_release=release and public.icash_outcome_cost_learning_active() then
  return; -- Idempotent retry: retain the existing evidence epoch and rollups.
 end if;
 seller_enabled:=public.icash_seller_contact_learning_active();
 cash_enabled:=public.icash_seller_cash_learning_active();
 select enabled into sms_enabled from icash_learning_policy_private.sms_settings where id=1;
 if not exists(select 1 from icash_learning_private.policy_releases r
  join icash_learning_policy_private.outcome_cost_settings c on c.id=1
  where r.release_sha=release and r.completed_at between c.installed_at and now() and r.registered_at<=now()) then
  raise exception 'Canonical successful post-install release required';
 end if;
 perform public.icash_activate_learning_policy(actor,release,false);
 update public.icash_learning_rollups set updated_at='-infinity';
 update icash_learning_policy_private.settings set evidence_after=now() where id=1;
 update public.icash_learning_queue set due_at=least(due_at,now()),generation=generation+1;
 perform public.icash_activate_learning_policy(actor,release,true);
 if not coalesce(sms_enabled,false) then
  update icash_learning_policy_private.sms_settings set enabled=false where id=1;
 end if;
 if seller_enabled then perform public.icash_activate_seller_contact_learning(actor,release,true);end if;
 if cash_enabled then perform public.icash_activate_cash_question_learning(actor,release,true);end if;
 perform public.icash_activate_outcome_cost_learning(actor,release,true);
end $cutover$;
commit;
```

Immediately verify the global SHA, the new active predicate, the prior scopes' preserved active states and the preserved SMS enabled flag. Existing assignments and decision/application records stay immutable. Until fresh rollups are recomputed after this transaction, the evidence epoch excludes their prior verdicts. Then verify scheduled account refreshes complete, the new outcome scopes are present, and canonical decisions use complete 30/60-day denominators or explicitly remain in exploration. Read-only collection or aggregate inspection must not claim a winner, contract or closing that the original receipts do not prove.

## Verification

Offline tests execute the actual forward SQL and its real seller-call/V6 consumers. They cover net coverage, remainder conservation, acquisition dispatch before ingestion, equal-maturity negative trials, unknown and conflicting costs, supplier/customer separation, original source bindings, activation, grants and SQL/TypeScript parity. Native PostgreSQL verifies the collector/integration and simultaneous title requests: original cost ownership is single and immutable, reuse is idempotent, and no billing operation is created by attribution.

The batch accepts at most 2,000 trial windows, with one original exposure time per property. A larger or invalid batch produces no partial cost cohort; every omitted mature result makes the consumer incomplete while preserving all outcome trials. The native regression checks the real 1,001-property refresh crossing this limit. Individual windows cap at 10,000 operations and the account source graph at 100,000 rows; encountering the extra sentinel row prevents certification.

The native scale test uses the real source/collector definitions, analyzed synthetic rows, representative original indexes and JIT disabled. With 500 synthetic properties and 1,500 operations, 100 properties / 200 windows took 96 ms; 500 properties / 1,000 windows took 734 ms. Both built the source graph once and conserved the exact customer costs. The actual 500-property seller-call refresh took 1.39 seconds enabled, and 498 ms disabled with zero graph calls. These are local fixture measurements, not production latency promises. The executable checks are `scripts/test-outcome-cost-scale-postgres.mjs` and `scripts/test-outcome-title-attribution-postgres.mjs`; the complete consumer suite is `tests/outcome-window-cost-learning.test.mjs`, with `ICASH_OUTCOME_NATIVE=1` for the fixed disposable native database.

No paid provider requests or production writes are part of these tests. A passing fixture establishes implementation behavior, not an observed production winner or new closed deal.

## Installation receipts

Migration `20261115064518_customer_results_outcome_costs` and its guarded forward
correction `20261115065409_outcome_cost_query_planning` installed on November 15,
2026. Collection/qualification remains disabled with no release SHA. New title
origin/reuse tables were empty at installation; historical ownership was not
reconstructed. The public activation function rejects ordinary browser roles.

A bounded read of the largest funded customer account exposed the original
generic-plan timeout. After the typed per-account planning correction, the normal
production function returned 7,458 source observations within the same eight-second
limit. The 282 unattributed observations remain evidence gaps; this read does not
certify complete economics. There were no funded customer screenings older than
30 days at this check, so mature production windows could not yet be observed.

All new SQL suites, TypeScript, native title contention, the native 1,001-property
cap, batch scale and skewed-account planning regressions passed before release.
The unchanged source query was independently compared byte-for-byte, and native
rowsets matched in both directions, including account isolation and null input.
No paid provider work was used for validation. Exact-release activation and
ordinary fresh learning receipts are still required.
