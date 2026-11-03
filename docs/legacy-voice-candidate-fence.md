# Exclude existing legacy voice routes before contact evidence

A production statement timeout at November 3 19:02:43 UTC entered
`icash_meta_pool_receipt_current` through the legacy permission branch of
`icash_queue_voice_jobs_before_operational`. The general worker logged the
corresponding database failure at 19:02:49. This is separate from the urgent
source gate in `icash_issue_ready_voice_ticket`.

Read-only inspection at 19:04:40 found one permission matching all cheap active
account/configuration/screening conditions, already bound to a non-callback
voice job. Zero candidates lacked an existing route. EXPLAIN of the original
SELECT showed its expensive voice/contact-evidence predicates evaluated in the
permission scan before the existing-job anti-join and account/screening checks.
This can revisit historical Meta evidence even though the job must be excluded.

The correction materializes the original cheap candidate conditions, including
both exact permission and operational account/screening/contact-key exclusions.
The same voice policy, DNC-or-seller evidence, financial-or-limited-contact
predicates then apply before the unchanged LIMIT 100. No early limit or cursor
is introduced; later eligible work remains selectable. The migration requires
the complete original function hash `a8eb1f89eb58fa1cd9aac427af6e7252` and replaces
only the first INSERT's SELECT. The callback, expired unstarted ticket recovery,
function attributes and ACLs stay unchanged. The parent scheduler/budget locks
and final provider admission remain unchanged. No existing job, permission,
contact, receipt or financial record is modified by installation.

A production READ ONLY counterfactual EXPLAIN ANALYZE of the new SELECT returned
zero candidates in 7.435 ms with 620 shared buffer hits and no writes. No row
reached the expensive CTE filter. The original was EXPLAIN-only to avoid
repeating its measured timeout. These are diagnostic query results, not
end-to-end production recovery or a controlled old/new latency comparison.

The PGlite regression loads the complete captured production function, verifies
its hash and exact single-fragment substitution, and uses throwing evidence
checks to ensure previously queued permission and operational routes are never
revalidated. It covers all historical job states, account/property/contact-key
and NULL matching, callback-only history, Pause, disabled configuration, revoked
and expired permissions, buyer exclusion, screening ownership/completion, voice
policy, DNC and seller evidence, financial and limited-contact paths, later
eligible accounts after 120 blocked candidates, the final 100-row cap, immutable
saved job history and service-only ACLs. Predicate boundaries are synthetic;
this is not a provider or paid calling test.

The native PostgreSQL script uses the same captured function and fixture,
checks custom/generic plan modes against 1,000 historical routes, and runs
24 concurrent queue calls under the unchanged scheduler lock. It also checks
operational history, Pause, late eligible work and the final cap. Its workflow
must pass before production installation. The existing full native suite remains
required; its timeout budget increases from five to seven minutes to include
the additional scenarios without deleting coverage.

No production mutation was performed while preparing this correction.
