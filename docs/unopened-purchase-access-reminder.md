# Access reminder for an unopened confirmation

The first purchase confirmation is immediate. The existing single reminder remains
due 15 minutes after the provider accepts that confirmation. For new confirmations
after activation, the reminder is eligible while no matching original-email open
or click has been recorded and no post-purchase course/workspace entry is saved.
Claiming an account alone no longer ends this reminder. Both queue claim and final
send authorization recheck the condition through the existing common predicate.

The signed Resend route records engagement separately from delivery. It retains
only the original purchase-email ID, exact provider and recipient binding, event
ID, kind and timestamps. A callback arriving before send bookkeeping can be saved
using the original tag and recipient; it suppresses the reminder only once the
saved provider ID agrees. Duplicate event IDs are immutable. Engagement never
changes membership, delivery status, acceptance receipts or suppression lists.
Unrelated emails are ignored. Invalid signatures are rejected and database
failures return 503 so the provider can retry.

Open tracking is imperfect: image blocking can hide opens and mailbox privacy
services can generate them. Absence is not called proof that an email was unread.
Actual course/workspace activity independently stops unnecessary reminders. A
signal arriving after final send authorization cannot recall an in-flight email.

All existing payment, live-mode, recipient, active-period, billing-review,
bounce/complaint/suppression, one-message-per-channel, provider idempotency and
retry-window rules remain. SMS eligibility and its disabled setting are unchanged.
Existing sent/canceled jobs are never requeued; earlier confirmations retain the
prior unclaimed-account rule. No 24-hour sequence or historical campaign is added.

## Rollout

1. Apply the generated migration, identical to
   `config/unopened-purchase-access-reminder.sql`. It checks the existing predicate
   hash and creates private RLS-protected data with the policy disabled. Apply
   `config/unopened-purchase-access-reminder-permissions.sql` next to replace
   Supabase's default service-role grants with the intended runtime privileges.
2. Require exact-head Reliability checks and the normal production release gates.
3. Verify the new signed webhook handler is deployed on the existing production
   domain. Preserve all existing Resend webhook subscriptions and add
   `email.opened` and `email.clicked` without changing the endpoint or secret.
4. Enable open tracking on the existing `geticashx.com` sending domain. Resend's
   setting is domain-wide; click tracking remains unchanged/off, so access links
   are not rewritten. Do not change the separate property-message domain.
5. After provider readback, set the private singleton policy enabled with a fresh
   `activated_at`. It applies only to confirmations created from this point.
   Confirm permissions, exact function definitions and policy readback.

Disable the policy to restore the prior reminder eligibility. Keep original
engagement and send records. This switch does not restore canceled jobs.

## Validation

Offline tests exercise the real current database predicate, claim and authorize
functions, early/duplicate/wrong-binding events, post-claim open races, actual
entry, old-history cutoff, disabled policy, immutable sends, original suppressions
and private permissions. Signed webhook tests check routing, validation, retries
and separation from delivery handlers. No real development email is sent.

## Installed prerequisite

Production migration `20261114175727_unopened_purchase_access_reminder` is installed
with the policy disabled. Readback confirmed RLS, denied anonymous/authenticated
engagement reads, denied anonymous RPC execution and service-only execution.
Observed function hashes: eligibility `6ea20d9b31af404cc3ca36f9c95d8384`, reminder
helper `2c0a49e82f45b12f9cd254f00e52a77e`, engagement recorder
`d184e343495f1c09985fe1319813bbf6`. No historical sends were started or requeued.
The CLI-created migration filename was aligned with the observed production
ledger version; its SQL remains byte-identical to the reviewed config file.

Follow-up migration `20261114180122_unopened_purchase_access_reminder_permissions`
is installed. Production readback confirms engagement grants are SELECT/INSERT
only and policy grants SELECT/UPDATE only for `service_role`; both retain RLS,
with no anonymous/authenticated grants. The policy remains disabled with a null
activation time and zero engagement rows. Regression tests reproduce Supabase's
default grants and exercise the explicit permission revocation.
