# iCash X software and webinar audit — October 16, 2026

The audit found and repaired recovery gaps in webinar playback and ending, support requests, several workspace requests, payment disclosures, and release coverage. Two published webinar settings were also corrected. The application build, all 416 local test suites, desktop and mobile Chromium journeys, and bounded concurrency checks passed. Production application/database/authentication/workflow health was current and healthy at 17:40 UTC. The most recent monitoring recovery email was independently confirmed **delivered** by its provider.

This is evidence for the tested scenarios and current configuration. It is not a guarantee of uninterrupted third-party services, every possible device/browser combination, or autonomous resolution of payment disputes and real-estate exceptions.

## Repairs

| Finding | Result |
| --- | --- |
| A video that stalled before its metadata arrived could show a play button indefinitely without recovery. | The player exposes Resume video after a bounded stall and reloads unfinished initial loading when connectivity returns. An ordinary paused video is not treated as a stalled download. |
| A failed webinar completion request could lose its checkout redirect, including after reconnecting. | Completion retries are bounded and deduplicated; a confirmed retry follows the same destination. An engaged payment form and a verified Standard/VIP purchase retain priority. |
| Support writes could remain pending without a deadline; a saved question with an interrupted reply could stay pending on retry. | Network and response-body deadlines restore the controls. Drafts and request identifiers survive failures. Retrying the same saved question can finish its answer once, with current account evidence and no second paid classification. |
| Conversation reads/sends, title-task changes, and buyer-visit review requests could remain waiting indefinitely. | Bounded request deadlines release the controls. Uncertain texts retain their existing reconciliation and idempotency rules rather than being automatically resent. |
| The early-access funding screen submitted its acknowledgment without showing the existing availability disclosure. | The disclosure is visible before payment in early-access mode, and that mode no longer promises that funding starts the bot. Normal released checkout retains its ordinary explanation. |
| The smaller release suite missed 19 outdated or broken full-suite fixtures. | Fixtures now exercise current APIs, composed UI, address pronunciation, verified VIP features, and current credit rules. A separate CI job runs **every** test suite before the existing production gate can pass. No production permission was weakened to satisfy a test. |
| Standard daytime verified purchase notifications were configured to begin at the video end. | Published webinar 100000 advanced from revision 29 to 30; the daytime start override is now empty, so verified notifications can begin with the offer. |
| The nighttime VIP final headline said three spots while its configured counter was one. | Published webinar 100002 advanced from revision 13 to 14; the final headline now says one VIP spot. |

The two live configuration edits used exact revision/value checks and affected one row each. Existing session snapshots keep their original timeline. Recorded purchase activity remains labeled as recorded; it is not represented as a new verified sale.

## Coverage and evidence

Source inventory: **37 pages, 205 route handlers, 533 buttons, 95 literal internal links, and 151 direct API references**. No missing destination was found in the static link/API checks, and no explicit `type="button"` was found without a handler, spread trigger, or disabled state. This structural check complements the behavior tests; it does not prove every possible button state by itself.

Every page was requested from the production build locally. Public pages rendered, protected owner pages redirected to the unlock screen, and none returned a server error. These were page-shell checks, not privileged production operations. The accompanying `2026-10-16-route-inventory.json` records every route and observed result.

| Journey | Evidence checked |
| --- | --- |
| Sign-in, tenant privacy, and owner controls | Authenticated API tests, expired-session refresh, owner-only navigation, denied-access data clearing, account-scoped reads and writes. |
| Standard purchase and VIP | Membership/payment service fixtures, entitlement checks, no duplicate submissions, paid-return routing, protected in-progress checkout, verified VIP access and upgrade prompts. |
| Day and night webinars | Four published MP4 URLs returned 200 with video content type and byte-range support. Session routing, one-hour return behavior, paired VIP entry, chat/contact skipping, offer timing, purchase notices, counters, and separate previews were tested. |
| Exiting and recovering playback | Real browser Close/Back, Stay/Leave/Escape, one-time dismissal persistence, no stacked exit dialogs, stalled initial media, reconnect, and failed-completion recovery. Browser/Instagram controls determine whether native exit confirmation is available. |
| Course | Real local HTTP upload bytes, video playback, PDF download, practice link order, VIP entitlement, visible owner upload controls, locked owner entry, and absence of customer upload controls. Both production course assets are uploaded at revision 1. |
| Workspace and deal cards | Search, retained drafts, staged panels, empty/loading/failure states, required acknowledgment, takeover success/failure, bot controls, VIP Ask AI access, call-history playback, and microphone-denial recovery. |
| Agreements | Purchase/assignment draft editing and saving, signature-request wiring, retained edits after refresh, signed-document visibility, cancellation status, delivery recovery, and immutable signed-history boundaries. |
| Buyers, deposits, visits, and title | Stage-specific next actions, deposit receipt requirements, visit states, title replies, document requests, payout readiness, cancellation holds, and failed-request recovery. These checks do not certify title, funds, or legal validity. |
| Calls, texts, and background work | Immediate opted-in callback admission, suppression/permission and credit checks, recorded-call boundaries, audio access, voice address expansion, receipt reconciliation, duplicate callbacks, and uncertain-result holds. Provider transport was mocked. |
| Support and cancellation | Account isolation, preserved drafts, same-request recovery, explicit unchecked cancellation acknowledgment, expiration, pending-versus-confirmed results, email signature validation, and safe provider uncertainty. |
| Operations and reporting | Owner performance/error views, failed refresh with retained data, current worker/maintenance heartbeats, workflow incidents, owner alerts, and the independent scheduled health probe. |

Local verification:

- `pnpm build`: passed, including TypeScript and route generation.
- `node scripts/test-all.mjs`: **all 416 suites passed** with provider credentials removed.
- `BROWSER_ENGINES=chromium node --experimental-strip-types tests/reliability-browser.mjs`: passed on desktop and mobile layouts using intercepted APIs and local media/files.
- Bounded concurrency: 12 concurrent requests, two accounts, zero duplicate sends, zero duplicate charges, and zero tenant mismatches. Two ambiguous outcomes stayed held. PGlite serializes database work; this is not a production capacity or multi-connection lock test.
- The CI release workflow also requires desktop Chromium and mobile WebKit. Production deployment remains blocked until the exact main-branch commit passes that workflow.

## Live operations observations

Vercel production was serving the current main release when the audit began. Railway had one healthy running worker. Two earlier worker deployments had been stopped by failed release checks before replacing that worker. No rollback of the healthy worker was needed.

The browser-phone configuration is ready. Enabled voice approvals, discovery reviews, and live signing templates were current; no enabled expired approval was found. The live voice review uses the standing approval expiration, not a short-lived replacement. No paid calls, texts, purchases, signing dispatches, or recharge tests were performed.

Monitoring had no open incident at its initial detailed check, fresh worker/maintenance heartbeats, and configured verified owner delivery. A later recovered-incident email was confirmed delivered. The public health probe was read with a fresh request and reported database, authentication, and workflows healthy. Transient historical incidents are retained; a healthy snapshot does not erase their history.

The database security advisor returned informational notices for RLS-enabled tables with no client policies. This is consistent with the server-mediated design; no permissive policy was added. The advisor reported no warning/error class in that result. [Supabase explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## What still requires responsibility

Routine monitoring and bounded recovery can run automatically. A responsible person still needs to handle escalated support, payment disputes, uncertain external provider outcomes, seller/buyer exceptions, title-company requests, and legally required review. The software intentionally pauses or requests review when it cannot safely confirm an outcome.

The existing support-style preview remains a separate draft; this release takes only the relevant request/reply recovery work. Protected deployed previews were not bypassed. Local built-app browser evidence and read-only production checks are distinguished above. Real paid carrier, payment, signature, title, and inbox delivery journeys were not newly exercised by this audit.
