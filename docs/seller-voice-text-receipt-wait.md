# Text preferences received before a call ends

A seller can text a preference while the matching call is still finishing.
The existing call-to-text predicate correctly requires a finished call, but
the incoming trigger previously left no reply job when that receipt was absent.
The later call receipt did not revisit that source. A fictional replay reproduces
the missing job; private case evidence supports this timing without proving an
unlogged historical branch.

The repair retains one pending job for a fresh, unambiguous “text me” preference.
It waits on the exact account, property and number-pair call, then uses the
existing deterministic reply and final-send admission. The job retains its
original recording ID and activation timestamp. Duplicate arrivals/resumes
cannot create a second outgoing message. This is neither ownership evidence nor
offer, contract or additional-call authority.

Waiting is limited to 15 minutes from the original source time. Missing or
changed receipts, new topics, Pause, human takeover, changed routing, provider
uncertainty and disabled/replaced activation remain held or require review.
The wait cannot fall through into paid AI analysis. No historical message is
replayed and no customer support message is sent by this change.

## Release

Install `config/seller-voice-text-receipt-wait.sql` using its matching migration,
after reviewing the guarded predecessor replacements. It installs disabled:
`voice_receipt_wait_enabled_at` remains NULL. It uses existing application and
worker RPC contracts and requires no worker restart or provider configuration.
Record the production migration receipt and read back function definitions and
service-role-only ACLs before adding the ready PR to automatic release.

After successful exact-head and exact-main checks and production READY/alias
verification, set the NULL activation field once to the current database
timestamp through the existing authorized release workflow. Read it back;
never backdate it. Clearing the field disables pending and ready replies that
came through this wait. Re-enabling uses a new timestamp and does not revive
the previous cohort. Preserve original jobs, messages and call/cost receipts.

`tests/seller-initial-reply.test.mjs` covers before/after behavior, no-send waits,
source/property/recipient boundaries, topic changes, current controls, historical
events, timeout, unknown operations, rollback and restricted function access.
`scripts/test-seller-progress-postgres.py` adds native concurrent duplicate
arrivals, uncommitted terminal receipt visibility, resumed outputs and final
claims. All provider activity remains disabled in these fixtures.

Support guidance and the underlying delivery path are separate fixes. Neither
a passing fixture nor deployment confirms resolution of an older customer case.
