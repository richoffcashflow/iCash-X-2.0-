# Workspace request recovery

Story: sign in, load the account, fund eligible work, use Run/Pause and open saved property/closing progress. Requests must finish or show a recoverable error, and a stale poll must not overwrite the result of an explicit control change.

## Evidence and fixes

The production workspace rendered the signed-in account, current credit balance, property cards, review queue and Run/Pause controls. Vercel returned no grouped runtime errors for the previous 24 hours. The browser's only observed console error came from its extension, not the application. These observations establish rendering, not a completed live transaction.

The code audit found unbounded client requests in account access, funding, activity, property actions and closing progress. A stalled connection could keep a loading or busy flag set indefinitely. The shared bounded client now covers those requests, including reading the response body. Aborted reads finish; writes are never retried automatically. An uncertain write explicitly tells the user it may have completed and to check its status.

Run/Pause and sign-in submissions have immediate in-flight guards. After a control change, sign-in, funding confirmation or membership update, the account refresh cancels an older request and reads a new snapshot. Generation checks exclude late snapshots. An uncertain Pause also reads the saved status. A failed sign-out is caught, and successful sign-out invalidates account reads that could otherwise restore stale private UI. Closing saves and title requests refresh their saved status after either success or uncertainty.

## Eight local failure scenarios

1. Stalled control write finishes once without automatically repeating.
2. Stalled response body cannot keep a read loading forever.
3. Caller cancellation prevents a request and excludes a late response.
4. A bad gateway or expired-access response is visible, and a later read recovers.
5. Duplicate Pause clicks send once; an older poll cannot reverse confirmed status.
6. Pause reaches the server but its response is lost: reread shows the saved pause and releases controls.
7. Failed sign-out is caught without claiming the account signed out.
8. Stalled sign-in releases the form; duplicate submissions send once.

All eight pass with mocked fetch and actual component handlers. No external provider requests or paid simulations run. Focused existing checks cover funding checkout/idempotency, account snapshots, durable billing stop, membership recovery, worker backoff, closing controls, subscription locking and the paid-provider stop. TypeScript and whitespace checks pass.

Two existing UI fixtures needed maintenance: the subscription renderer now stubs its CSS imports, and the simplified-workspace check verifies the current manual-control status policy instead of searching for retired literal copy. Its naming case now distinguishes an unnamed new bot from an already named account. Product styling and control policy were not changed for those fixtures.

No database migration, provider billing change, credit purchase, customer message or live control mutation is part of this release. Existing signed-document/privacy holds and disabled voice-candidate gates remain. A production build and successful rendering do not establish a completed customer payment, live phone conversation or title closing.
