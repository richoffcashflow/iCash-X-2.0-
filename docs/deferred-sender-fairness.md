# Deferred sender fairness

A delayed physical sender can admit a fresh cold introduction every five minutes
while older unattempted follow-ups repeatedly lose their retry opportunity. More
workers do not fix that ordering. An offline reproduction using the current queue,
delay and retry definitions repeats the starvation three times before this change.

The queue and its candidate reader now yield to a matching deferred original
that has waited at least one minute. This applies to that physical sending number
only. The retry keeps its original message, account, binding and claim kind; the
existing final claim still decides whether any transport or spend is permitted.
No new message or provider request is created by the fairness helper.

Priority is bounded:

- A selected retry keeps its turn for thirty seconds, then yields until its next
  existing five-minute check if the final claim could not proceed.
- Healthy retry batches retain preference for overdue originals, even when a
  backlog takes several passes. One private timestamp records selector activity;
  its update skips a busy row rather than delaying another selector.
- After the selector stops, its backlog extension expires in two minutes.
  An individual retry's existing due window expires one minute after its check
  was due, so a worker stopping immediately after rescheduling can hold
  preference for at most six minutes.
- Actual dispatch removes the waiting entry through the existing trigger.
- Changed drafts, expired waiting entries, provider IDs, prior delivery receipts,
  existing operations or sender uses, superseding conversation evidence, account
  Pause, retired routes and opt-outs do not hold a turn. Automatic work also
  respects thread Pause and manual takeover. Original manual claims stay manual.

This changes scheduling preference, not dispatch authority. Shared rolling
capacity, cold limits, contact hours, original signed provider-delay evidence,
financial checks, consent, sender identity and unknown original money remain
unchanged. Requested introductions retain the queue's existing exemption from
cold pacing. Transactional messages retain their existing separate admission.
The scheduling preference includes deferred transactional originals; their existing
classification runs at retry/final admission, not again for every fresh candidate.
Previously queued or in-flight work still passes the same final limits; a turn
is not a promise that the provider will accept or deliver a message.

The migration checks the three exact predecessor definitions and private execute
privileges under the existing dispatcher/budget locks before adding one
private selection timestamp/index/helper, one service-only progress row, and
patching those three functions. It does not
alter the dispatcher, claim functions, triggers, volume limits, provider events,
account health definition or activation policy. There is no separate activation.
Old application workers remain compatible with the unchanged retry response.
Install only once after exact-head checks, preserve the installation receipt,
and verify the normal serialized source release and exact production deployments.
The migration runner owns the transaction and history insert; a later history
failure rolls back all schema/function changes together.

Validation uses synthetic data and local PostgreSQL only. It covers the repeated
starvation reproduction, a healthy eight-row backlog before an overdue original,
bounded failed-claim and worker-outage cases, invalid
originals, manual routing, unchanged final claim/volume functions, service-only
access and concurrent queue/selection/claim races. Production verification is
read-only observation of ordinary work; no paid demonstration or replay is
authorized. A successful retry or a lower health count does not prove delivery,
a human answer, a closed deal or zero stalled accounts.

## November 17 installation

Installed once as `20261117182800_deferred_sender_fairness` after the original
head `2d9ea57c2dc7c6bc3a7fda9d2883440520b62060` passed all seven canonical jobs
in run `43954947635`, independent source review, and fresh focused regression.
The source SQL SHA256 is
`4cf85099a32ef29a3dc660c54070a451a5cfad097c20b1cbdde84656250d0d54`.
Do not reinstall, replay historical messages or reset waiting rows.

Readback at `2026-11-17T18:28:03.956235Z` confirmed these function MD5s:

- `icash_queue_seller_opener`: `b03410d6c985b43f33f16b3600f89bca`
- `icash_seller_opener_candidate_body`: `956ad1becf415caf4bf29e66b25f9fdd`
- `icash_next_sender_volume_retry`: `019ca6f6bf5d3461f1d940ffc481a3ef`
- `icash_sender_private.waiting_turn`: `65c91d315ba5b232d86cfe748368a849`

Postgres ownership, service-only execution and empty search paths were retained;
the waiting-number index was valid and ready. The private progress table had
its sole singleton row, with a null timestamp before ordinary retry activity.
The repository filename now matches the hosted ledger version.

The current-main composition passes the focused fairness, deferred four-text
batch, fresh-sender preference, sender volume/pacing, original receipt recovery
and text-claim refusal regressions. Fresh exact-head checks and serialized
exact-main deployment verification still apply. This installation establishes
scheduling fairness, not successful delivery or recovery of every account.
