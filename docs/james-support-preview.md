# iCash Support preview

`/preview/support` runs the same support conversation component with a per-browser, in-memory transport. The preview never falls back to a live request. Its bot, payment and interrupted-connection examples are fictional; cancellation is unavailable and team requests stay in the sample conversation.

The chat is branded iCash Support. A small Automated support note identifies the automated replies. Real operator messages retain the Support team label. Short replies have a reading/typing pace of 1.8–3.6 seconds from submission. Slow network requests do not receive another full artificial delay. After eight seconds, the indicator says the account is still being checked. Errors and confirmed team/cancellation actions have no artificial delay. Reduced-motion settings stop the typing animation.

Support reads are bounded at 15 seconds. Writes, including reading their response bodies, are bounded at 45 seconds and are never automatically repeated. A failed message preserves its draft and original request ID. The server checks that a replay matches the original account, thread and message. If its reply was never saved, recovery uses local classification and the existing atomic finish receipt, avoiding another paid classifier request or duplicate reply. Finished replays do not run diagnostics again.

Closing the mounted panel during a reply preserves the operation. Background reads cannot overwrite newer requests. Sign-out clears the conversation and pending confirmation. The cancellation instructions now have a matching Manage cancellation control under Chat options, with the existing explicit confirmation unchanged.

## Operational scope

Existing production monitoring checks application, database, authentication, worker heartbeat and maintenance freshness. Existing incident alerts and release checks remain in place. These changes do not grant support permission to place calls, resend contracts, charge/refund customers, change provider settings or deploy fixes.

The team handoff enters the existing support queue; it is not proof that a person has read or resolved the issue. A staffed escalation owner is still needed for unresolved requests, outages and uncertain provider results. Neither the preview nor passing health checks establishes zero defects, guaranteed uptime or unattended resolution of every customer issue.

## Verification

Focused local tests cover fetch/body deadlines, preserved request IDs, pending-reply recovery without paid reclassification, cancellation confirmation, account isolation, and sign-out. Browser scenarios cover actual reading/typing transitions, desktop/mobile layouts, close/reopen during a response, sample isolation, lost-response retry, duplicate submit protection and cleared account history. Tests use local fixtures; they do not call paid providers or change real accounts.
