# Scheduled outreach waiting and account health

The account monitor previously reported `no_completed_work` after thirty minutes even when overnight contact preparation had filled the opportunity buffer and new outreach was waiting for its existing 9 AM–9 PM window.

The new observation excludes only a positively established scheduled wait: a full current opportunity buffer, no current enrichment candidate, an enabled voice campaign, current source/identity-bound eligible contacts and an unattempted prepared voice job. Every current voice/SMS contact must have a valid, closed canonical window. Both the last real completed task and every current contact must be newer than the last closing time. This prevents an old daytime stall from becoming healthy merely because night falls. Unknown timezones fail closed; legacy conservative NANP metadata uses the existing Chicago fallback.

Unfinished screening, seller-reply analysis, due callbacks or requested/cancellation calls, active deal stages, alternate permission routes and recent seller conversations prevent the exception. The predicate is deliberately narrow; unsupported routes remain subject to the existing monitor. As soon as any current contact's window opens, the ordinary thirty-minute progress rule applies again.

Only the `no_completed_work` condition changes. Configuration, system Pause, explicit customer Pause, pending financial holds, independent workflow incidents and stale-monitor behavior remain intact. This is read-only observation, not final outreach admission or proof of a call, text, reply or sale. No work, contact, original uncertain operation or money is reset. The interface and outreach hours are unchanged.

## Verification and rollout

`node --experimental-strip-types tests/account-work-outreach-wait.test.mjs` exercises the real observation query, canonical timezone/window/conversation functions and synthetic source records. It covers exact opening time, a prior missed window, mixed windows, invalid/old evidence, live work, recipient requests, existing reason precedence, private privileges and immutable financial evidence. The existing account-work outage and incident suites cover snapshot recovery and independent alerts. These checks make no provider requests.

Apply the predecessor-guarded migration with `outreach_wait_settings.enabled=false`. After exact-head Reliability checks, normal merge, successful exact-main checks and verified production readiness, enable that one private setting. Verify the live predicate, query time and the next independent account-health snapshot. Disabling the setting restores the previous observation immediately on the next monitor pass. Do not manufacture a completion or clear unrelated incident records.
