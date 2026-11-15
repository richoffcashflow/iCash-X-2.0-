# Customer-results delivery review

Read-only production checks on November 15, 2026, around 1:25 AM Eastern
(12:25 AM Central) found the following queue populations. These are historical
message rows, not unique customers, currently sendable leads, or failed sends.

| Observed population | Messages |
| --- | ---: |
| Outgoing, `ready`, no provider message ID | 1,988 |
| Same population, created more than 24 hours earlier | 1,962 |
| Enabled original sender | 336 |
| Linked screening completed within 24 hours | 15 |
| Current stored contact/permission expiry | 33 |
| Enabled sender, fresh screening/contact expiry, account and thread unpaused | 14 |
| Those 14 already in the sender-volume retry queue | 13 |

The categories overlap. The first two counts were collected before the later
joined checks; this is not a single transactional snapshot. Joining original
message/account/thread, deal and screening identities established the remaining
counts. Screening freshness and stored expiry alone do not establish final
contact eligibility, available funds, valid cadence or sending authority.

All 14 basic fresh candidates returned false from the existing sender-room
check. The configured November cold-sender policy enforces 9 AM–9 PM Eastern,
in addition to its rolling volume and spacing limits. These checks ran outside
that window, so false availability is not evidence of numeric-cap exhaustion or
a preventable stall. Several candidates also lacked a current contact window;
one failed the full contact review. No candidate was claimed or sent.

The broader backlog includes 1,652 messages with a disabled original sender.
Most rows also lack fresh screening or contact evidence. A ready state does not
authorize changing a conversation's number, extending evidence dates, clearing
an unknown operation, or replaying historical outreach. The existing deferred
lane already examines up to four candidates per pass and preserves each
original send claim. A separate bounded selector retries eligible originals;
neither path grants authority missing from the underlying message.

## Existing receipt recovery

Current main contains the exact database-acknowledgment retry described in
[text-receipt-acknowledgment-recovery-2026-11-15.md](text-receipt-acknowledgment-recovery-2026-11-15.md).
It saves the same collected original receipt at most twice under one deadline,
without another provider read, provider send, attempt claim or financial change.
Runtime deployment verification belongs to the release record; source presence
alone does not prove that the running worker contains it or that a customer
received a text.

An independent read of the production worker deployment records still showed
the previous worker release successful and the newer receipt-retry release
failed. Comparing those exact source revisions found only the receipt recovery
implementation, its tests and its documentation between them. Thus the receipt
acknowledgment retry is the identified application change still missing from
that worker at this observation. It is not a claim that every delivery defect
has been found. A later release must verify the new worker revision and status;
this review did not restart, redeploy or otherwise change the service.

No further delivery-code change was justified by these queue checks. They do
not establish that all messaging paths are correct, that every old message can
be recovered, or that the backlog is cleared. Restoring eligible follow-through
requires current source evidence, original sender readiness, ordinary final
admission and actual provider outcomes. Historical holds and diagnostics remain
intact.
