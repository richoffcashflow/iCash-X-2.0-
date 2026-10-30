# Scheduler reliability

Production database logs on October 30, 2026 showed statement timeouts in call-capacity selection and budget-ticket recovery. A read-only plan for `icash_voice_contact_holds()` examined roughly 3,400 candidate rows to return about 20 current holds. The issuer called that same global projection repeatedly while considering eligible jobs.

The scheduler now reuses one private snapshot across candidate checks. Final call admission always constructs a fresh snapshot and retains the existing transaction locks, limits, receipt rules and recipient exclusions. The original global-capacity shortcut remains in place. The snapshot is never accepted from a public request and never changes provider or billing evidence.

Budget recovery previously selected twenty tickets before checking whether their jobs were still resumable or an original operation already existed. Older blocked rows could hide eligible work on later rows. Those existing checks now also filter the selection before its limit; the original checks remain after row locking. A partial index covers held budget tickets.

Worker logs now distinguish allowlisted database timeout, lock, connection, permission and missing-schema codes. Response text, SQL, hints and customer data are discarded after a bounded read. Failures do not replay an RPC or provider request.

`tests/scheduler-reliability.test.mjs` uses the exact pre-change production functions with synthetic database rows. It compares capacity decisions before and after the migration, measures repeated scan counts, verifies fresh final admission, reproduces blocked recovery batches, checks helper privileges and verifies that installation changes no job, wallet or original capability. These local tests do not establish real multi-session throughput or authorize paid provider tests.

Release the guarded migration with the application changes. It preserves public function signatures and is compatible with the existing worker and API. Check original function hashes before application, then inspect normal worker activity and database timeout counts. Rolling back application code alone does not undo the SQL optimization; restore the affected function definitions from the pre-change fixture if database rollback is necessary. Keep the additive helper functions and index until no deployed code references them.
