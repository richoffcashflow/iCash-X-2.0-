# Funded account work outages

A customer screenshot showed a running bot, eligible matches and no outreach. The initial November 2 audit found 80 active, unpaused accounts with no positive settled charge in 24 hours. Admission pricing narrowed that group to 22 accounts able to fund another task; 58 were below their current admission amount after commitments. Zero spend alone is not proof of a platform outage.

The audit found two concrete faults. The October 26 standing research review skipped configurations with unresolved acquisitions, including safely quarantined searches in another ZIP. Those configurations later expired. Separately, generic estimated settlement could race receipt-specific research settlement, use the whole quoted allowance and the standard multiplier, then trigger the account margin pause. Eleven historical operations matched this path; five funded active accounts had the corresponding automatic pause.

## Repair boundaries

- Route every research settlement through the original observed-credit receipt and immutable operation multipliers. Missing or conflicting receipts remain held.
- Record exact historical corrections separately. Original operations, cost manifests and provider evidence remain unchanged. Credit only a demonstrated net overcharge, after existing platform coverage; never retrospectively debit a customer.
- Neutralize the corrected operation's historical margin contribution only while its complete original operation and manifest still match the correction. It cannot provide margin headroom for later work.
- Resume only a correction-proven system pause with unchanged customer control, active membership, available funds and no billing/cancellation block. A new customer Pause wins under the existing operating-budget/account locks.
- Complete only the already-approved standing research rate mapping. Preserve rates, ZIP, revision, page, caps and original quarantined snapshots. An unknown current search prevents the change. Owner-contact receipts remain bound to the original operation; their caps and evidence are untouched.

## Detection and display

Maintenance observes funded accounts independently of worker heartbeats. It detects expired/disabled configuration, pauses without a current customer Pause, no completed work for 30 minutes, and overdue work consuming the remaining credits. Customer Pause, expired membership, billing/cancellation restrictions, insufficient total funding, missing acknowledgment, newly funded/resumed accounts and the owner's discovery-excluded demonstration account are excluded.

Three affected accounts make the incident critical. Account outages have independent detection, escalation and 15-minute observed recovery memory, so an older unresolved workflow incident cannot hide a new outage. Existing bounded hourly reminders and uncertain-notification protections remain intact.

The owner dashboard shows exact counts and up to 25 affected account references. Customer status uses the account-bound cached finding to display “Work delayed”; a new ticket alone does not clear an outage. Stale monitoring displays unavailable status. This does not promise seller replies, leads, spending targets or completed deals.

## Verification and release

Offline PostgreSQL fixtures reproduce the old billing race, test receipt pricing, exact credits, changed-evidence rejection, explicit Pause, original unknown holds, standing-rate lineage/cursor/scope, tenant isolation, healthy-worker outages, alert rearming and stale monitoring. Native PostgreSQL exercises concurrent correction, settlement and Pause. Desktop Chromium/mobile WebKit verify the critical dashboard and blocked customer display with intercepted APIs only.

The three database migrations precede the compatible app/worker release. The two repair RPCs are service-only; ordinary maintenance runs only the narrow standing-configuration repair. Historical corrections and recovery of automatic pauses are an explicit audited repair batch. No provider calls, paid tests, historical outreach replay, top-up or provider-plan change are part of verification.

Production migrations were applied on November 2 at 21:00–21:04 UTC. The audited batch recorded 11 corrections and 83 cents of net credits across three accounts. Four accounts still held by the demonstrated system pause were resumed; the fifth original account had already resumed, so its controls were untouched. All five original accounts were then unpaused with valid margin. Ten independent expired configurations received their exact standing mapping; two current unknown searches retained their original configuration. The 11 original operation rows have the same before/after hash, `584a25fc9686e92d663b1a1bf89b4173`.

The first expanded snapshot at 21:05 UTC still showed 105 affected accounts (53 without completed work, 50 with overdue pending work and two expired configurations). These remain unresolved; configuration repair or a running worker is not evidence of completed customer work. The observation query took 443 ms against production. Native PostgreSQL passed 72 competing correction/settlement calls, duplicate-credit checks and the concurrent customer-Pause case; the initial Chromium/WebKit release checks also passed.
