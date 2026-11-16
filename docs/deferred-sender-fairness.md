# Deferred sender fairness

A delayed physical sender can admit a fresh cold introduction every five minutes
while older unattempted follow-ups repeatedly lose their retry opportunity. More
workers do not fix that ordering. An offline reproduction using the current queue,
delay and retry definitions repeats the starvation three times before this change.

The queue and its candidate reader now yield to a matching deferred cold message
that has waited at least one minute. This applies to that physical sending number
only. The retry keeps its original message, account, binding and claim kind; the
existing final claim still decides whether any transport or spend is permitted.
No new message or provider request is created by the fairness helper.

Priority is bounded:

- A selected retry keeps its turn for thirty seconds, then yields until its next
  existing five-minute check if the final claim could not proceed.
- A retry worker more than one minute late loses priority until it checks again.
  A worker stopping immediately after rescheduling can therefore hold priority
  for at most six minutes.
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
Previously queued or in-flight work still passes the same final limits; a turn
is not a promise that the provider will accept or deliver a message.

The migration checks the three exact predecessor definitions before adding one
private timestamp/index/helper and patching those three functions. It does not
alter the dispatcher, claim functions, triggers, volume limits, provider events,
account health definition or activation policy. There is no separate activation.
Old application workers remain compatible with the unchanged retry response.
Install only once after exact-head checks, preserve the installation receipt,
and verify the normal serialized source release and exact production deployments.

Validation uses synthetic data and local PostgreSQL only. It covers the repeated
starvation reproduction, bounded failed-claim and worker-outage cases, invalid
originals, manual routing, unchanged final claim/volume functions, service-only
access and concurrent queue/selection/claim races. Production verification is
read-only observation of ordinary work; no paid demonstration or replay is
authorized. A successful retry or a lower health count does not prove delivery,
a human answer, a closed deal or zero stalled accounts.
