# Automatic work recovery — November 17

The core PR803 release addresses distinct scheduling and reporting failures
observed during the owner's stalled-account investigation. It preserves the
reviewed component commits as ancestors rather than deploying competing copies.

| Component | Behavior | Verified database prerequisite |
| --- | --- | --- |
| PR803 | Reuse one stable reserve calculation within acquisition capacity checking | Installed once as `20261117180236_acquisition_capacity_single_state` |
| PR805 | Skip research ranking when the report's existing configuration/rate check already fails | Installed once as `20261117180250_usage_context_research_precheck` |
| PR790 | Give eligible original deferred messages a bounded turn before fresh introductions | Installed once as `20261117182800_deferred_sender_fairness` |
| PR793 | Retain explicitly empty owner audiences from validated free previews | Installed once as `20261116210706_owner_preview_empty_audience`; application change pending |
| PR792 | Separate optional policy-review cursors from canonical foreground source writes | Installed once as `20261117190712_policy_review_lock_isolation` |
| PR815 | Keep both existing account/property control checks as exact indexed lookups | Installed once as `20261117184814_seller_opener_property_lookup` |
| Pending-confirmation activity | Show actual current work alongside unresolved originals, or neutral confirmation status when idle | No database change |

The original PR793 packaging proposal also mentioned PR777 and PR783. That
combination was never implemented. This release includes only the independently
reviewed empty-owner change from PR793. It does not include or activate the
three-touch policy from PR783, consume another feature's activation, or change
PR777's separate queue. Existing migration receipts remain intact.

## Release evidence and boundaries

All six database prerequisites have hosted installation receipts. Their
component documents record the source checks and readbacks. Each repository
migration filename matches its actual hosted version.

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

## Combined follow-on after the core release

PR803 ships independently. PR817 then carries the reviewed PR816 contact-source
gate and corrected PR817 credit-wait change together, preserving their source
commits and the finalized core release as ancestors. The source components are
PR816 `2a3474af4a1db1c9c95881a6f7825daa064bb4fe` and corrected PR817
`9f9b0ee0c4e223087db7496fa793b624ed94d87c`. They are incorporated once;
component checks do not replace the combined follow-on's final checks.

| Follow-on component | Behavior | Verified database prerequisite |
| --- | --- | --- |
| PR816 | Skip global outreach inspection when the necessary local contact source cannot exist | Installed once as `20261117185740_owner_wait_local_gate`; no separate activation |
| PR817 | Detect replenished provider data credits through bounded free checks while retaining independent export-capacity proof | Installed once, disabled, as `20261117191836_provider_credit_wait`; activation requires the matching exact-main web and workers |

The component documents record both installations, source digests, immutable
originals and verified policy boundaries. Do not replay these prerequisites or
the six core prerequisites. The corrected PR817 source passed all seven
canonical jobs in run `44154406866`; require an independent review and all seven
fresh canonical jobs for the complete follow-on head before its expected-head
merge and exact-main release checks. Activate only the credit-wait policy after
matching production hosts are verified. PR816 requires no activation.

A confirmed provider credit wait is distinct from customer funding or an
application failure. Its free checks do not buy credits, settle unknown money,
repeat the original purchase or prove completed outreach. Preserve those
distinctions in post-release progress and recurrence evidence.
