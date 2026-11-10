# Fresh owner demo sender preference

The November 10 owner request asks for the most confirmed numbers for their own demo. This extends `owner-demo-call-capable-routing.sql`, which already prevents fresh call-requested demo SMS threads from selecting an SMS-only lease.

Only the exact presenting owner account, owner actor, self phone, matched assigned intake and fresh five-minute call-request receipt qualify. Before any thread or call identity exists for that run, SMS and voice choose from enabled SMS and verified outbound-call-capable numbers using the same preference:

1. Signed, source-bound carrier-delay recovery first. An unresolved notice in the last hour outranks older success even after ordinary five-minute probe admission resumes. Only a verified later-dispatched delivery or notice expiry clears this preference penalty; normal sending eligibility is unchanged.
2. The smaller of the two recent confirmation counts, then their total. SMS requires a delivered provider ID and exact account/thread/actual dispatch. Recorded calls require an actual provider-started and ended session with its dispatched operation and matching registered provider/caller identity. These are transport observations, not evidence that a person answered or read a message, and not measured success rates.
3. The original deterministic hash for ties and when no recent evidence exists.

Each channel reads at most 500 eligible receipts per line from the preceding seven days before counting. Production provider/operation uniqueness prevents duplicate sampling without a full pre-limit distinct sort. The legacy primary number has no current outbound provider identity in the shared number registry, so its old calls earn no call-confirmation preference; its normal eligibility and deterministic fallback remain unchanged. Future, stale, missing-dispatch, mismatched-account and unfinished receipts do not count. No per-recipient personal data is returned. Ordinary accounts, non-self demos, expired requests, disabled voice choices, existing current-run threads and unknown calls retain their existing behavior. Disabled/conflicted/suppressed numbers remain ineligible regardless of evidence. A disabled line is never enabled by ranking.

The migration only adds a private read-only evidence helper, an index and a guarded selector update. It does not archive any run, send/replay outreach, change call-request expiry, alter billing, or update historical bindings. New-run lifecycle retirement is separate. Final call and SMS admission remains authoritative if readiness changes after selection.

Offline checks: `node --experimental-strip-types tests/owner-demo-confirmed-sender.test.mjs` applies the exact preceding number migrations and owner call-capable migration, then tests the new migration and actual selector. No paid or live provider tests.
