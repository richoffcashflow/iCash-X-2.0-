# Seller reminder contact refresh

This fixes **one cold reminder after one introduction**, not an ongoing follow-up sequence. The cold reminder cadence remains 3–5 days after the one delivered introduction. Its original national DNC observation expires after 24 hours. The seller cron now obtains a **new** exact-phone observation when a prospective reminder is due and otherwise eligible, then applies the exact-source revalidation from PR #547. It does not stretch an old receipt's date.

The release enables the refresh scheduler only for gaps created after the migration's recorded activation timestamp. The historical held backlog stays held. A fair bounded scan checks at most 20 candidates per pass; at most one new provider request is admitted per minute and once per gap. This is not an automatic retry of an unknown send or a historical reminder replay.

## Provider contract and cost

Official documentation checked November 4, 2026:

- [Check DNC](https://api.docs.dealmachine.com/api-reference/phones/check-dnc): `POST https://api.v2.dealmachine.com/v1/phones/dnc`, body `{phones:[{number:"+1…"}]}`. A single submitted phone has one result with echoed `input.number`, boolean `matched`, optional boolean `do_not_call`, and `totals` and `credits` counters. Matched phones cost at most one credit each; unmatched phones are free. Billing-month deduplication is used only when the actual receipt reports it.
- [Get people](https://api.docs.dealmachine.com/api-reference/people/get-people): the existing free owner preview is not a fresh exact-phone DNC observation. The new path uses the documented phone endpoint and existing credentials.
- [Credits](https://api.docs.dealmachine.com/concepts/credits): credit usage must come from the response; cached or repeated phone data is never assumed free.

The new `contact_revalidation` operation derives a one-credit cap from the account's current verified owner-contact rate and current DealMachine unit-cost setting. It retains the existing non-data allocations, buffer, expiry, company budget, customer wallet, membership, scope, daily limits, prospecting allowance, next-outreach reserve and saved 3×/VIP data-price rules. The original rate is unchanged. An unknown provider response or unresolved cost-review operation stops new refresh claims globally until reconciled, bounding ambiguous spend to one outstanding request. The final charge uses actual returned credits. Missing or malformed cost receipts retain the reservation for review. The shared provider limiter admits the exact request ID atomically with the money claim; phone checks do not consume the protected first-account request reserve.

## Receipt and contact controls

The claim is durable before HTTP. A timeout, process crash or lost response leaves that request unknown; no worker retries it. A lost database acknowledgement may retry only the identical raw receipt write. Subsequent cron passes process saved responses without another provider request. Non-200 responses, malformed counts, another phone, multiple results and inconsistent credits cannot settle as a clear contact check. Matched=false and missing, null, string or true `do_not_call` values never clear the hold.

The original purchased owner result, its cost trail, original operational contact, original DNC observation and original send remain unchanged. The successor has evidence kind `national_phone_observation` and references its immutable refresh request/response, exact account, screening, original contact and operation. Every use rechecks the old source binding and the new response. Its expiry is the earliest of 24 hours from the new request's database claim, the source policy maximum, source expiry and customer data-rights expiry. The provider does **not** supply a registry-updated timestamp; `checked_at` is the conservative request-start bound. National-only status establishes neither state-list clearance nor consent.

Immediately before rebinding, the real cadence, global recipient suppression, route, identity, source, account Pause, thread Pause, manual takeover, contact revocation, original delivered message, financial-screen age, pending/unknown outgoing work and recovery-attempt controls run again. Rebinding uses the existing PR #547 immutable snapshot and one-use audit. The normal SMS preparation and dispatch guards still own any later send. The refresh worker sends no SMS.

## Release and rollback

Apply the CLI-generated seller-contact-revalidation migration first, then the seller-contact-refresh migration, before deploying the cron import. The latter combines schema, financial admission, workflow and operator summary SQL in that order. It creates no credentials, enables no national source policy, changes no old receipt and releases no historical hold. The existing national source policy must already be enabled and current.

To stop new checks and successor contact application, set `icash_seller_recovery_private.contact_refresh_policy.enabled=false`. Saved provider receipts may still reconcile actual costs. Existing contact/sender/Pause/STOP and normal dispatch controls remain authoritative. Do not delete requests, rewrite unknown outcomes, extend old receipt dates or reset the activation timestamp to bulk-replay the backlog.

The stop command preserves financial reconciliation and all existing paid receipts:

```sql
begin;
set local lock_timeout='5s';
update icash_seller_recovery_private.contact_refresh_policy set enabled=false where id=1;
update icash_seller_recovery_private.contact_revalidation_policy set enabled=false where id=1;
commit;
```

Do not remove the billing wrapper or reverse charges as a code rollback. A request already paid for still needs its actual receipt settled. Disabling this workflow does not retroactively revoke an already applied fresh observation; current source disable, contact revocation, Pause and STOP remain available through their existing controls.

Read-only installation checks:

```sql
select public.icash_seller_contact_refresh_summary();
select enabled,activated_at,scan_due_at,scan_gap_id
from icash_seller_recovery_private.contact_refresh_policy;
select observation_provider,observation_scope,enabled,expires_at,max_observation_age_seconds
from public.icash_dnc_verification_sources
where evidence_kind='national_provider_observation' and observation_provider='dealmachine';
select role_name,
 has_function_privilege(role_name,'public.icash_claim_seller_contact_refresh()','EXECUTE') can_claim,
 has_function_privilege(role_name,'icash_seller_recovery_private.reserve_contact_refresh(uuid,uuid,uuid,bigint)','EXECUTE') can_bypass
from unnest(array['anon','authenticated','service_role']) role_name;
```

Expected grants: only `service_role` can call the public claim; none of those three roles can call the private reservation helper directly. Immediately after installation, request counts are zero and the older held backlog remains unchanged. No paid smoke test is required or permitted as development verification.

`icash_seller_contact_refresh_summary()` is service-only. It distinguishes the untouched pre-activation backlog, new gaps awaiting checks, unknown requests, pending saved responses and terminal outcomes. These counts are operator diagnostics, not promises that held work is eligible to send.

Verification uses offline synthetic provider responses only: actual contact/ancestry/cadence/revalidation SQL, actual wallet/reservation/settlement SQL, malformed and missing evidence, late Pause/STOP/source expiry, exact receipt immutability, single-request concurrency and customer pricing. No paid development checks are used.
