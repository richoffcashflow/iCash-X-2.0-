# Fresh owner self-demo calling hours

The stored request explicitly includes outside-hours calling, but app eligibility, final DB admission and the queue independently enforce ordinary09:00–21:00 hours. This patch honors only the exact presenting owner's fresh request to their own configured phone through existing `icash_owner_demo_call_current`.

Original request expiry reaches server-side app eligibility; expiry is not renewed. Reservation, claim and final dial independently recheck the full SQL helper. Both ready-ticket predicates and the budget-resume predicate retain ordinary hours OR the same helper. Held jobs remain ineligible. No jobs are replayed or refreshed. Ordinary seller calls/callbacks, SMS/email and shared outreach window remain unchanged, as do funding, opt-outs, identity and in-flight controls.

## Release order
Deploy application FIRST and verify exact commit, THEN apply migration20261031131902. Old app after SQL could defer a fresh nighttime job until morning and expire its receipt. New app with old SQL keeps ordinary-hours behavior. No live call is part of validation; any demonstration requires a fresh owner-triggered form request.

## Validation
Reconstructed after ephemeral workspace reset from reviewed implementation history; rerun current validation before release. Earlier local validation passed644/645 suites, including19 offline DB scenarios and TypeScript. Two test-only UTC formatting corrections preserve fixture meaning across session timezones. An unchanged research-efficiency-database.test.mjs:140 failure also reproduced on clean main. Do not claim full CI green until exact-commit checks resolve this.
