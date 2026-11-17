# Automatic work recovery — November 17

This coordinated release addresses distinct scheduling and reporting failures
observed during the owner's stalled-account investigation. It preserves the
reviewed component commits as ancestors rather than deploying competing copies.

| Component | Behavior | Database prerequisite at preparation |
| --- | --- | --- |
| PR803 | Reuse one stable reserve calculation within acquisition capacity checking | Installed once as `20261117180236_acquisition_capacity_single_state` |
| PR805 | Skip research ranking when the report's existing configuration/rate check already fails | Installed once as `20261117180250_usage_context_research_precheck` |
| PR790 | Give eligible original deferred messages a bounded turn before fresh introductions | Installed once as `20261117182800_deferred_sender_fairness` |
| PR793 | Retain explicitly empty owner audiences from validated free previews | Installed once as `20261116210706_owner_preview_empty_audience`; application change pending |
| PR792 | Separate optional policy-review cursors from canonical foreground source writes | Not installed; exact source, metadata and relation checks required |
| PR815 | Keep both existing account/property control checks as exact indexed lookups | Not installed; exact source and metadata checks required |
| Pending-confirmation activity | Show actual current work alongside unresolved originals, or neutral confirmation status when idle | No database change |

The original PR793 packaging proposal also mentioned PR777 and PR783. That
combination was never implemented. This release includes only the independently
reviewed empty-owner change from PR793. It does not include or activate the
three-touch policy from PR783, consume another feature's activation, or change
PR777's separate queue. Existing migration receipts remain intact.

## Release evidence and boundaries

The first four prerequisites above are acknowledged installations. Do not replay
them. Their component documents contain exact receipts and verification. The two
remaining migrations must run once through the hosted transaction-owning runner,
only after successful canonical checks and fresh pinned-source verification.
Record actual hosted versions and reconcile filenames after installation. A
known lock refusal with complete rollback is different from an ambiguous write;
inspect current state before any bounded retry.

Require an independent review of the complete combined tree and its latest
seven-job canonical Reliability checks. Use a normal expected-head merge,
exact-main push checks, and matching production web, worker and monitor evidence.
Component PRs are incorporated by ancestry once, not separately redeployed. A
database installation, green preview or worker heartbeat alone is not proof of
application release or account recovery.

The activity correction changes the owner preview's interpretation of
`pending_work`: a valid unexpired consumed ticket or running screening lease may
appear with an explicit note that earlier work awaits confirmation. Idle pending
work has no live indicator. Actual missing-completion/configuration blocks,
customer Pause, stale data and account isolation retain their precedence.
The normal customer Run/Pause presentation remains intact.

No change clears monitoring findings, infers zero provider cost, releases an
unknown original hold, repeats a paid operation, changes contact permission,
or bypasses final admission. The investigation still observed pending receipts
and scheduler timeouts; this package is not evidence that every account is
recovered. Verify ordinary completed work and recurrence after release without
paid development demonstrations.
