# Automatic workflow blockers — October 18, 2026

The owner's requirement is automatic operation for every eligible current and future user. This follow-up traces work before dispatch; a healthy worker or an empty queue does not prove that contact occurred.

## Repairs

| Failure | Change | Verification |
| --- | --- | --- |
| Seller response status required both channels to have receipts, even with a future scheduled call or an explicit SMS-only choice. | Scheduled/claimed calls remain queued. SMS-only accounts complete initial contact after the actual SMS receipt and do not queue a call. | Actual consent/response/recording SQL fixture: future call not issued early, delivered text not resent, uncertain call remains held, explicit SMS-only choice respected. |
| New-address lookup failures or disabled acquisition prevented processing of already-assigned seller responses. | Existing response work runs independently; newly assigned leads retain their immediate targeted handoff. | Authorized route fixtures cover lookup and allocation failures, disabled acquisition, new assignments and no same-tick retry. |
| Discovery readiness, unstarted SMS recovery, manual SMS and legacy work recommendations still required the full planning estimate in the wallet. | Match deployed actual-usage admission: a positive balance. Preserve rates, final claims and actual-cost settlement. | Reproduced the old failures with one cent and a higher quote; actual SQL admits otherwise-eligible work after the patch. Zero balance, Pause, market rights, strategy and ownership checks still apply. |
| Reliability checks only detected errors after work had started. | Also detect overdue first seller contact and stuck buyer preparation. | Actual monitor SQL catches an absent first-send queue, excludes scheduled future calls and intentional holds, and clears after receipts. No contact or provider data appears in reports. |

The expanded monitor uses a new private refresh RPC. The database migration can precede the app deployment without adding issue types to the old app's refresh path. Its existing cache, owner incident workflow and receipt reconciliation remain intact.

## Production observations before release

- All four funded, running accounts passed the platform configuration checks. Their channel setup is automatic.
- The real seller lead has a delivered text and a first call scheduled for the next calling window. Its old `needs_setup` label was false; the call's timing and receipt are not altered by this release.
- Acquisition is configured as inbound. This release does not silently switch customers to paid cold prospecting.
- The two signed owner test deals remain under explicit holds and manual property pauses, with no available credits or permitted direct buyer contacts. They are not evidence of completed buyer delivery.

No paid development simulations, invented recipient permissions, new live test messages, balance changes or provider retries were used. This is scoped regression and production-configuration evidence, not certification of every possible app state or a newly completed live buyer transaction.
