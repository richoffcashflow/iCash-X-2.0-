# Independent exclusion list synchronization

The provider list can be synchronized while the ordinary query exclusion policy
stays disabled. `exclusion_sync_enabled` defaults to false. With only this switch
on, ordinary maintenance can claim a bounded batch for the exact saved ready list.
A missing list or unknown state cannot trigger creation or recovery. Both existing
outbound property IDs and eligible acquired targeting IDs retain their original
pending selection and receipt handling.

The existing shared request limiter remains authoritative. Accountless maintenance
cannot use new-user protected requests. The starter claim's protected-capacity
path and its final account/list proof are unchanged; its ordinary-capacity path
continues to delegate to the global claim. No customer configuration, query-policy
receipt, revision, Pause state, money hold or provider counter is changed.

Apply `20261104053431_research_exclusion_sync_control.sql` inactive. Run the focused
sync-control and existing reserve/exclusion suites. Verify the exact reviewed web
and worker deployments and inspect the actual saved ready idle list. Only then use
`config/activate-research-exclusion-sync.sql` as a reviewed transaction plan with
its release SHA and exact list ID supplied after `begin`. It rejects missing or
changed bindings and an enabled old query policy. The file is not a deployment
hook and must not run unattended. This implementation has not activated production.

After activation, observe ordinary sync receipts and pending backlog shrinkage.
A claimed batch is not a provider receipt, and a synchronized list is not proof of
better research results. Targeting readiness may independently require an attached
or explicitly bound list; this switch does not supply or rewrite that binding.

To pause future maintenance claims, set only `exclusion_sync_enabled=false` under
operator review. Leave original in-flight leases/receipts and the finish function
intact. Keep `exclusions_enabled=false`; do not enable the known problematic query
policy as a shortcut to synchronizing the list.
