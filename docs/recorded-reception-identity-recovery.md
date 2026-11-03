# Original incoming-call identity recovery

Nine terminal incoming-call sessions observed on November 3 still had no bound
AI conversation identity. Their original carrier/audio receipts and reserved
costs remain unresolved. The independent reception queue retried every minute,
with thousands of attempts, outside the account-followup backoff policy.

The maintenance handler now records an allowlisted identity or binding review
reason. Only an unchanged session with a confirmed carrier ending over 24 hours
old, terminal recording state and no conversation identity backs off from five
to fifteen to sixty minutes. A generic provider failure, active call, new call,
known conversation or incomplete audio keeps its previous recovery cadence.
Deletion and active termination remain independent and unchanged. Recovery only
reads the original call/recording/conversation; it never registers or dials again.

A receipt transition during the lease keeps reconciliation immediately due;
one arriving after completion likewise wakes the original session. Original
row-version, account, operation and lease checks remain authoritative. An empty
or mismatched conversation inventory is never zero-cost evidence and never
releases reserved money. Hourly fallback remains necessary because this lane
has no verified ElevenLabs post-call webhook.

The guarded migration is compatible with the existing handler: old generic
reasons do not enable the longer delay. Install after the actual-service,
database and native callback/worker race scenarios pass, then release the
matching application through the exact-commit gates. Observe ordinary receipt
recovery and saved review reasons; a lower poll count does not mean a customer
hold was settled. No paid development calls or new provider operations are part
of these checks.
