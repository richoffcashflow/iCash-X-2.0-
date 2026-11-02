# Owner demo call transaction repair

A November 2 owner-submitted demo saved and assigned its property, accepted its
text, then threw SQLSTATE 25006 before a call operation or provider request was
created. The original call remained issued. The production PostgREST error
traced `icash_voice_outreach_context` through `icash_owner_demo_call_current` to
the permission check's `SELECT FOR SHARE`.

PostgREST 14 runs STABLE RPCs in a read-only transaction even for POST. The owner
hours patch introduced a locking permission check into that entry point without
changing its STABLE metadata. The subsequent phone-spacing RPC had the same
problem. Mark the context, hours and phone-spacing entry points VOLATILE. Keep
the exact function bodies, privileges, locks and contact/funding/expiry gates.

Reference: https://docs.postgrest.org/en/v14/references/transactions.html#access-mode-on-functions

The existing spacing database fixture now retains the permission row lock and
exercises the documented POST transaction mode. It reproduces all three errors
before the migration, succeeds afterward, and confirms unchanged bodies/ACLs,
account isolation, expiry and no call creation. This is an offline database
test, not a live phone test or a native concurrency claim. No lock order changes.

Apply the metadata-only migration and reload PostgREST's schema cache. Existing
application callers already use POST. Do not renew the failed request or replay
an expired demo. A new live demonstration still needs a fresh owner submission.

## Production verification

Applied as migration `20261102171244_owner_demo_rpc_transaction` on November 2,
2026. All three entry points report VOLATILE; their body hashes, service-role-only
ACLs, security mode and search paths match the pre-migration snapshot exactly.
The saved request's context and locking permission query return successfully.
Its original expired demo exception remains false, with no operation, provider
call ID, conversation or recording created. A live phone call was not retested.

The owner approved publication of this fix and its regression tests to the
existing public `richoffcashflow/iCash-X-2.0-` repository on November 2, 2026.
