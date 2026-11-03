# Literal business identity in seller introductions

The November 3 read-only stalled-account audit found nine unstarted seller text
threads across two accounts whose saved business identity includes ASCII `&`
(U+0026). They had an allowed conversation window, current sender/rate snapshots
and valid-length text, but the opener's old character allowlist returned null.
These were source candidates, not proof of final authority to send: one property
was manually controlled, and all current consent, balance and admission checks
remain required.

Allow exactly that literal character in the identity helper, requested-recipient
helper, candidate preview and queue. Preserve the complete saved identity,
address and STOP instruction. Do not normalize identity, rewrite `&` as `and`,
truncate text, extend 160 characters, permit other unsupported characters or alter
old assignments/messages. The queue's existing optional experiment-copy guard
uses the same one-character allowance; no experiment selection changes.

The existing `lib/sms-length.ts` and installed `icash_sms_single_segment` already
count `&` as one GSM unit, and `icash_queue_text` uses that unchanged financial
segment check. The GSM character map lists it as a basic character:
https://www.twilio.com/docs/glossary/what-is-gsm-7-character-encoding
No price, reservation, customer budget or provider call changes are needed.

The guarded migration changes only these character predicates and preserves
function ACLs and every other statement. Offline tests reproduce the old failure
and run the actual captured copy, queue, routing, price and assignment observers.
Native scenarios race 24 issuers and changed Pause/source/expiry under the existing
admission locks. Source-review helpers in these fixtures remain explicit test
boundaries; these tests do not perform or claim a complete paid send. Production
verification must use ordinary new work and original settled receipts after the
exact release passes its required checks.
