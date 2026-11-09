# Context-aware seller call preferences

## Conversation behavior

A current preference for text is not a permanent ban on ever discussing a call.
Continue by text immediately. An optional call may be offered once later only
when actual property/deal facts have progressed since that preference and the
seller supplies a fresh, direct reason that explaining by text is difficult.
Time passing, message counts, a model summary, quoted third-party remarks and a
stage label alone do not establish that need. Do not add unnecessary questions
to reach an arbitrary turn count.

A firm no to the call question, no calls, or don't ask again prevents unsolicited
re-invitations. A renewed text preference after the later suggestion prevents
another suggestion. Existing source-word refusals, STOP, manual takeover and
unknown operations remain authoritative. An unanswered invitation is not a reason
to repeat it. Known cancelled unsent drafts do not establish a preference.

Compute the ordinary text negotiation step first. Never replace an answerable
price or fees question, a supported quote, exact-term correction, acceptance,
signing confirmation or ready agreement with a call pitch. Invitation replies do
not accept a price, and saved quote revisions and commercial authority remain
unchanged. Bare yes asks for the missing time; it does not dial.

Only received direct seller words and original delivered questions through the
current source are interpreted. A quoted statement does not become an instruction,
and a real direct preference beside quoted material is still respected. The
existing exact invitation body is preserved because scheduled callback routing
also recognizes it: “When is a good time to talk about a cash offer?”

## Separate suggestion and calling authority

The application reads invitation capability by account, thread and actual source
message. It does not trust input flags or treat the ability to send a question as
permission to call. The server must find the original admissible voice target.
An operational SMS contact is not voice authority: a separately current reviewed
voice target must match its source and original DNC evidence.

A later explicit seller request may enter the one-request calling workflow.
A first operational call request can also use that workflow, but only with a
separately reviewed current voice target and no unresolved historical preference.
The original intake request path remains valid when no new exception is needed.
The new automatic exception requires a fresh immediate-call request. Future-date
availability continues through the existing saved callback-coordination workflow;
it does not automatically book a call, extend request freshness or clear a pause.
Global voice pauses and ordinary campaign permission are not reset. Each request
must retain its account, thread, phone, route, property/screening, source receipt
and existing contact evidence. Unknown or historical preference provenance must
not manufacture a new exception. A direct request never revives STOP, revoked
consent, customer Pause, manual takeover or unknown provider work.

The dispatcher obtains fresh source-bound proof before provider reads and retains
normal operational DNC checks, current calling hours, pricing, funds, provider
configuration and final atomic admission. Intake request consent is scoped to this
job. It is not persisted as general consent. A late preference change or STOP must
be checked again at final admission. No new quiet-hours exception is created.

A new verified request prospectively supersedes only an untouched ordinary job
for the same account and exact target. Under the admission lock, ready/issued
jobs with no operation, spend, recording, provider or conversation evidence receive
a specific hold so they cannot block the requested call or dial a duplicate later.
Already held, started, reserved or unknown work is not reset. A prior call is
considered finished only by the existing canonical terminal-receipt predicate,
including its exact settled carrier receipt case. A recording end time alone is
not proof that the phone call ended. The dispatcher also
checks current preference before provider reads and durably holds rejected work;
a preference rejection must not be mislabeled as insufficient credit.

## Verification and coordinated release

The feature is prepared disabled, with prospective source evidence only. Database
installation, application release and activation are separate gates. Do not enable
new exceptions before matching web and worker releases and all exact-commit checks
have passed. A code merge, passing planner fixture or healthy worker is not proof
that the database prerequisite or production activation completed.

Release order:

1. Independently review the exact application, SQL and fixture diff. Require the
   exact-head canonical CI, including the dedicated `seller-one-call-contention`
   job on PostgreSQL 17.6. Read current predecessor definitions before installing;
   abort on drift rather than overwrite another repair.
2. Install the approved `20261109043504_seller_one_call_consent.sql` migration
   while disabled. Verify the migration receipt, private ledger access rules,
   original global voice predicate and disabled setting. Do not backfill historical
   messages or reset existing jobs. Installation alone must not create exceptions.
3. Release matching web and worker application commits through the normal gates.
   Verify exact-main CI, actual live web aliases and the successful worker commit.
4. Only after the approved coordinated release, set the private singleton
   `icash_seller_call_private.settings` to `enabled = true` and set its first
   `activated_at` to the actual activation time. Read that result back. Do not
   backdate it to admit old requests or move it to reuse old source evidence.
5. Verify only read-only configuration and prospective normal-operation receipts.
   Do not trigger a customer call or paid test to prove activation.

The emergency stop is `enabled = false`, not deletion of request or preference
rows, restoration of campaigns, or an earlier web build that skips final proof.
Captured preferences remain holds when disabled. Existing valid legacy intake
requests retain their original path; new exceptions stop. Keep original request,
call, billing and unknown-provider evidence for reconciliation.

Focused offline suites include seller-call-preference, seller-call-preference-service,
seller-call-invitation, live-dispatch and the existing offer/qualification/agreement
suites. The full exact-head canonical suite, build/browser checks and native SQL
concurrency tests remain required. Tests must cover original source identity,
quoted/negated instructions, both contact types, newer stop/preference races,
concurrent duplicate requests, final clock boundaries and unknown-call no retry.

No historical negotiation replay, customer test call, paid development test or
provider timing/configuration change is part of this feature. These tests cannot
establish acoustic voice quality or future conversion outcomes.
