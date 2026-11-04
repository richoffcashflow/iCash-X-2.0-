# Reviewed seller contact revalidation

## Finding and scope

The three-to-five-day cold seller reminder policy and the saved DealMachine
observation's 24-hour validity do not overlap. `icash_open_seller_gap` therefore
holds a new reminder when its due date is beyond the thread's current checks,
even if those checks have not expired yet. Earlier reminders may also miss their
original window. Customer attention filtering hides this internal condition but
does not renew evidence or resume messages. Owner-preflight renewal is a separate
free research check and cannot repair an existing seller thread's contact proof.

The existing DNC importer is intentionally immutable and returns
`already_recorded` for the original purchase. PR #547 originally supplied no fresh DNC
lookup/refresh integration. The [new companion refresh](seller-contact-refresh.md)
now supplies an independently requested national phone observation and joins
this exact revalidation primitive to the seller cron. Re-running the importer, changing
timestamps, using another property's observation, changing the sender/identity,
or reopening every historical reminder is not a repair.

## Exact revalidation primitive

`20261104141659_seller_contact_revalidation.sql` creates an initially disabled,
service-only, individually reviewed path. It has no scheduler hook, evidence
importer, network operation, paid lookup, automatic enrollment, or activation.
Installing it alone changes no existing contact, thread, reminder or message.
The companion refresh migration subsequently enables this primitive and calls it
only after a new cost-admitted exact-phone response passes current controls.

1. A trusted operator obtains a genuinely newer, independently valid receipt
   through an approved source and the existing contact preparation path. This
   release cannot manufacture that receipt. The new immutable SMS contact must
   match the original account, property, owner, principal, phone, source hash,
   timezone and contact hours exactly. The original contact/receipt must not be
   revoked or no longer clear. Fresh receipts must have a newer check time, be
   no more than 24 hours old at review and pass the real current contact gate.
2. Read `icash_seller_contact_revalidation_snapshot(gap_id, new_contact_id)` and
   review the complete gap, thread, old/new contacts, receipts and source rows.
   Supply the SHA-256 of that canonical JSONB text plus a meaningful review
   reference to `icash_review_seller_contact_revalidation`. The immutable review
   lasts 30 minutes and by itself does not change any authority or hold.
3. After release verification and separately approved policy activation, apply
   the exact review ID with `icash_apply_seller_contact_revalidation`. There is no
   batch application. A changed snapshot, expired review, Pause, takeover, STOP,
   route hold, changed identity/source, unknown/queued send, pending AI work,
   prior recovery attempt, other live gap or unsettled owner purchase rejects it.
4. Apply only accepts an original delivered text's due, unsent `no_response`
   draft gap that still fits the unchanged three-to-five-day cadence. The
   property must remain complete and financially eligible, with a nonfuture
   result less than seven days old, matching existing non-price final dispatch.
   Property manual controls remain authoritative. This is not a new valuation,
   offer, contract, consent or contact-ownership approval.
5. Under the scheduler, budget, recipient, account and evidence locks, the exact
   new contact/DNC binding is recorded and that one gap becomes open. The real
   contact, SMS and recovery validators must pass. A failure or expiry during
   final validation rolls back both changes. Immutable before/after evidence is
   saved once; receipts, original contacts, source/due/expiry, sender, property,
   controls, messages and money are unchanged. Ordinary scheduling and every
   final dispatch gate still apply. Applying a review does not send a message.

## Verification

- `tests/seller-contact-revalidation.test.mjs` uses the actual operational contact,
  SMS, cadence and seller recovery functions with synthetic offline records. It
  verifies liveness only after a valid new receipt, rejection boundaries,
  unchanged evidence/money, one-use application, private access and atomic
  rollback. Existing follow-up, text health, workspace and support suites remain
  required. The long-lived source test proves review hash invalidation, not a
  permission to extend a real source's lifetime.
- `scripts/test-seller-contact-revalidation-postgres.py` runs only against the
  fixed disposable localhost `icash_reliability` database. It checks 24 competing
  applications, late Pause/disable/STOP, and review expiry during final validation.
  Its small native fixture uses deterministic contact-validator substitutes for
  lock/race isolation; the separate PGlite suite tests the actual evidence gates.
  This native script is included in required Reliability checks.
- No paid provider demonstration or production revalidation is part of testing.

## Release and remaining dependency

Keep the policy disabled until independent review, exact-head/main Reliability
checks, native concurrency and matching web/worker releases are verified. Read
back the installed function bodies and private grants before any activation.
Any historical revalidation needs its own real new evidence and current review;
the old list of affected gaps is not authorization to send them.

At investigation time no newer valid same-account/property SMS evidence existed
for the reported customer. This candidate therefore does not establish that any
held follow-up can resume. Completing automatic recovery still needs an approved
fresh-evidence source with real receipts, pricing and bounded admission. Do not
claim the outage is repaired merely because this inactive code is installed.

Rollback disables future applications without deleting audit evidence or
replacing a new binding with an expired one. Existing final admission continues
to enforce controls and expiry. Any reversal of an already applied gap is a
separate reviewed action.
