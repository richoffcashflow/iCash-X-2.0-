# Eligible SMS preparation

On November 16 the owner requested higher call and text volume. A read-only
production check found 875 saved SMS contacts without a current thread, including
104 with screening older than 24 hours and 13 with manual property control. The
groups overlap. Existing final projection rejects these prospects, but the
expensive source/routing checks and 100-candidate limit ran before those checks.
An early rejected cohort could therefore starve an otherwise eligible account.

The migration copies only the final screening/account identity, completed state,
financial eligibility, original 24-hour completion window and manual-control
predicates into the existing materialized candidate stage. Missing, future and
NULL screening evidence still fails the same SQL comparisons. Missing drafts
remain eligible for the existing automatic draft handoff. The source validator,
sender selection, ordering, limit, locked insertion loop and final dispatch are
unchanged. This prepares threads; it does not send a message or charge a wallet.

The migration is pinned to the captured production function and has bounded
lock/statement timeouts. It changes no data, grants, contact evidence, timestamps,
caller identity, provider limits or unknown operations. It is compatible with
the currently deployed handler and needs no feature activation. Apply only after
the local SQL regression and native race checks pass; verify the exact installed
definition, then register the same migration and tests in the normal release.

The complete-function regression places 125 stale prospects ahead of a valid
funded account. The original function prepares zero threads; the repair prepares
one, with instrumented routing calls falling from 226 to two in that synthetic
case. Native PostgreSQL tests retain concurrent once-only projection and recheck
late Pause, manual control, screening expiry, source withdrawal and empty funds.
These results establish the reproduced defect and retained boundaries, not a
measured increase in delivered production texts or completed seller calls.

The current call queue also contains older number-verification holds. Existing
conversation routes must not switch numbers to conceal those holds. The separate
November 15 number registration remains inactive until actual provider
assignment, forwarding and caller identity are verified. No number purchase or
paid demonstration is part of this repair.
