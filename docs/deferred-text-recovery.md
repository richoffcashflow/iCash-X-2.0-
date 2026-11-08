# Deferred text recovery

The November 8 read-only investigation found both stale and fresh financial
screenings in the sender-volume waiting queue. Final dispatch correctly refuses
stale screening, but the maintenance lane previously ended after that first
refusal. A ready message is not proof that it remains eligible to send.

The lane now makes at most four selector calls per invocation and stops on a
repeated message ID. It continues only after the existing `message_held`,
`business_number_mismatch` or `seller_inventory_unavailable` result. Each result
occurs before SMS transport. Selection already defers that same entry's next
check by five minutes, allowing the bounded pass to examine another entry.

The original automatic, manual or Meta claim is used without changes. The first
SMS transport attempt ends the pass, including an uncertain provider response
or receipt-persistence failure. Unknown database errors propagate. Configuration
and sender-verification failures stop the pass. No provider attempt is repeated.

This is queue fairness, not clearance of the historical backlog. It does not
renew financial screening, DNC evidence or consent; rotate a thread's sender;
enable a disabled line; change rolling volume caps; or buy fresh research.
Existing conversations keep their number and every final admission check.

The large stale discovery backlog needs a separately reviewed, source-bound
refresh workflow with durable one-use request and original cost/receipt guards.
The existing paid seller-intake refresh cannot safely be applied wholesale to
discovered properties. Missing terminal receipts remain unknown.

Verification uses actual service bodies with synthetic database and provider
fixtures. Tests cover mixed held/eligible queues, the four-selection bound,
duplicate bindings, original claim paths, disabled lines, configuration errors,
unknown claims, provider timeouts and receipt failures. Existing sender-volume
database tests remain required. No live messages or paid smoke tests are used.

Release requires independent review, exact-head Reliability checks, then the
normal automatic-release controller and exact-main production verification.
An offline pass does not establish new production throughput or delivery.
