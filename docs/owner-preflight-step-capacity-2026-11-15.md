# Existing owner-count phases at their actual request cost

The installed owner preflight claim, due selector, acquisition selector and
service all required three request tokens before an existing list could run
its baseline and eligible counts. That phase sends two requests. With two
ordinary paced tokens available, valid original lists waited while the
acquisition headroom policy saved a third token for new work.

The disabled overlay admits only a known, source-bound `waiting` list within
its original 30-minute lifetime, with no cleanup or terminal count receipt,
whose next phase is baseline plus eligible. It requires two ordinary tokens.
The one-argument capacity predicate delegates to a NULL account; the production
starter allowance returns zero for NULL. Metadata, ready checks, new owner work,
and paid admission keep their original rules. Final individual requests still
pass the unchanged atomic limiter. Selection is not a request reservation.

Two continuation turns are followed by the original ordinary turn. On that
ordinary turn the exception stops, allowing the third token to accrue for new
work. A claimed continuation remains valid independently of the later fair turn.

The service may resume only its exact pending source at the lower threshold.
If the source changes or counts complete, it must regain normal capacity before
fetching a fresh owner preview. Original source/contact/funds controls, immutable
receipts and unknown-operation holds remain authoritative. This overlay does
not recover expired lists or replay uncertain provider requests.

## Evidence and limits

The November 14 23:58–23:59 UTC read found 1,803 preflights created since 00:15
UTC. None of the successive lists for the same account and primary screening
were created within 30 minutes. That does not support a claim of duplicate-list
churn within the validity window. All 3,818 admitted `owner-batch:` free-preview
metrics reported HTTP 200 and zero credits. Only 68 had matching empty-preview
receipts and 189 had matching final batches; the remaining previews cannot be
individually attributed from those metrics alone. They are not all proven
redundant reads. These observations do not establish account recovery.

Offline tests execute captured production claim, due, cohort, capacity and
scheduler definitions. They reproduce the two-token wait, verify exact-source
progress, original IDs/TTL/receipts, account controls, ordinary fairness,
protected-reserve exclusion, ACLs and disabled-policy rollback. Provider and
budget fixtures remain synthetic. The native PostgreSQL runner additionally
tests same-list claims, activation races, final request contention and enclosing
migration rollback. Local native execution requires the isolated localhost
PostgreSQL fixture; production is never a substitute.

## Release order

1. Run focused suites, full canonical CI/build and the isolated native runner.
2. Install `20261115000614_owner_preflight_step_capacity.sql` **disabled before
   deploying the service**, because the new read-only RPC is a code prerequisite.
3. Install any accompanying held-ticket recovery migration after this overlay;
   its claim/due prerequisite hashes and activation manifest must describe the
   combined final functions. Keep prior policy activation receipts unchanged.
4. Use the existing release controller and verify the exact main commit on web
   and worker. Activate the overlay only with its reviewed function manifest and
   release hash, with the existing fair-continuation policy enabled.
5. Observe naturally occurring counts, request receipts, original batch
   completion and the unchanged 363-account cohort. No paid demonstration or
   zero-stall claim is part of this release.

Rollback is `enabled=false` on
`icash_work_private.preflight_step_policy` under the normal release process.
It restores three-token selection/claim behavior without removing recorded
requests, deleting lists, changing their lifetime or reversing actual costs.
The app may remain deployed because the disabled read-only RPC returns false.
An already claimed handler retains the ordinary original lease and final
request admission; rollback does not cancel an uncertain provider operation.
