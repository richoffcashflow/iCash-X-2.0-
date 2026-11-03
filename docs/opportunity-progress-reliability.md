# Opportunity reporting and recurring scheduler failures

The November 3 screenshot had seven-day call/text history above a zero-valued opportunity panel. The latter filtered every metric by the newest funding budget's creation time. Funding after property discovery therefore removed existing properties and their subsequent outreach from the panel, even though real activity remained recorded.

## Reporting correction

Both customer workspace and the owner's read-only customer view share the selected Today, 7 days or 30 days period and browser timezone. A new private, read-only report counts original property and provider evidence independently of funding. Screening and eligibility describe unique properties first screened in the period; contact and reply counts describe unique properties with qualifying events in the period, including older properties. These are not call/text attempt totals and do not claim seller interest. The existing opt-out and practice exclusions remain.

The progress GET no longer refreshes the outcome cache. Both routes bind the account on the server, validate period parameters and independently validate every report count. Missing data returns an unavailable response rather than inheriting the legacy budget's zero counts. The client keeps confirmed values on a failed refresh only within the same account, period and timezone. Period/account changes hide mismatched values immediately; late former-scope responses cannot replace current data. Funding refreshes the report without resetting its history. Budget and customer Run/Pause controls remain separate.

## Recurring worker errors

The worker previously forgot a database scheduling failure after any successful or idle request. Three observed scheduler database failures in the same pool within 15 minutes now keep its health body degraded, even if successful or idle polls intervene. Each pool retains only the latest three timestamps; they expire automatically. The existing persistent heartbeat and operator outage monitoring receive this degraded status. This bounded recurrence window is process-local and starts fresh after a restart; stored heartbeat and incident history remain unchanged.

Independent work, retry backoff and existing HTTP health/held thresholds remain unchanged. This detects repeated scheduler errors; it does not repair the underlying query or prove that all accounts progress. Account-work monitoring remains authoritative for stalled funded accounts, and actual provider capacity remains a separate prerequisite.

## Verification and release

Regression coverage includes funding after historical research, same-period reporting, older-property outreach, duplicate properties/channels, practice and tenant exclusion, no-budget activity, invalid/missing report counts, stale response races, recurring errors across scheduler slots, expiry and heartbeat propagation. No paid provider demonstrations or replayed outreach are part of this change.

Install the additive service-role-only reporting function before deploying its callers. Require the repository's exact-commit Reliability checks and matching production web/worker versions. Verify the new read-only report against original production evidence after installation. Rollback callers to the preceding release if needed; the additive unused function does not change production admission or financial state.

Database installation verified: `20261103181449_opportunity_progress_report` and `20261103181532_opportunity_progress_call_timestamps`. The final function is STABLE, SECURITY INVOKER and callable only by the service role; direct anonymous/authenticated execution is denied. Source-backed production readback matches the observed historical totals.
