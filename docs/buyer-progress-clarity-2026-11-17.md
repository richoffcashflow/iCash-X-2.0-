# Buyer progress stays consistent with saved changes

The November 17 audit reproduced stale next-step guidance inside Visits & buyer deposit. The parent refresh button and successful availability/deposit saves refreshed the coordination record but not its nested journey or visit list. Recording an agreed deposit deadline also left the old displayed deadline in place. A successful visit update refreshed only the visit list, leaving its sibling next-step card unchanged.

The existing refresh action now reaches both child reads, and a successful visit update requests the same parent refresh. A confirmed deadline save rereads its own journey. These refreshes perform reads; they do not repeat deposits, confirmations, messages, documents, or provider operations. Unsaved availability/deadline drafts and a selected visit's original version remain intact. A changed visit still requires a fresh selection and its existing server-side version check. A successful read no longer clears the error from a rejected visit save, and editing a deadline clears an earlier saved acknowledgment.

Closed journey rows are returned by the existing progress RPC but previously fell through active guidance. They now display Buyer request closed with saved history, without suggesting resumed buyer contact or a new signature. The exact existing SQL closes journeys when their deal stage is no longer active; link expiry remains `needs_review`. Closed requests still surface unresolved message-review evidence even if the corresponding original is outside the newest-20 message list, and retain the saved blocker note without offering live recovery on a closed request. This does not say the deal closed, a signature completed, or funds arrived.

The three-day inactivity text now reports the absence of recorded buyer progress and asks the user to review saved replies and follow-ups. Age alone does not prove that scheduled reminders were delivered.

Validation:

- Seven actual-component fixture scenarios in `tests/buyer-progress-refresh.test.mjs` pass with the changes. The six original scenarios fail on predecessor `f865b5cb962db3c7701c6994e598deeb6ccb0e1e`; a seventh checks initial read failure and recovery after separating action errors. They cover parent/child refresh, exact deposit-save request count, deadline reread, draft retention, stale visit-version rejection, successful visit propagation, closed history, and age-based wording.
- Existing next-action, property-followthrough, assistant-context and workspace-view suites pass.
- The existing workspace browser scenario now exercises the refresh button, retained deadline draft and closed-request display on desktop/mobile with mocked API responses. Canonical browser execution is required; no local browser result is claimed here.

No migrations, production actions, customer messages, provider calls, financial/consent changes, UI layout changes, or read-only owner-view controls are introduced. Customer authority and original uncertain operations remain unchanged.
