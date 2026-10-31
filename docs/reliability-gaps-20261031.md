# Reliability fixes — October 31, 2026

The production review found an unresolved DealMachine export holding the organization export slot while the scheduler continued issuing contact tickets. The last-day sample contained 1,901 contact tickets held with `owner_preview_retry_exhausted` across 58 accounts. The worker and maintenance heartbeats were current; running workers alone did not establish successful acquisition.

`owner-export-scheduling.sql` makes contact selection check the existing active-export capacity result before scanning candidates or resuming parked contact tickets. When contacts cannot run, their cheaper quote cannot qualify an unaffordable property search. Filtering happens before the parked-ticket limit, leaving eligible text and discovery work available. Normal contact selection resumes when the existing capacity check becomes ready. The migration neither releases unknown purchases nor replays failed work, resets retry counters, or changes financial admission.

`owner-export-monitoring.sql` adds a high-priority owner-contact finding after an unreviewed export has blocked the organization slot for five minutes. Only resource ID, account ID and original timestamp reach the operator report. Provider bodies and original requests stay private. Fresh exports and exports with separately verified capacity reviews are excluded. Existing historical acknowledgements cannot acknowledge this new finding.

Apply the scheduling migration after its regression checks. Apply the monitoring migration only after the application that accepts `owner_export` is live. Both migrations check the existing function definitions before patching them. They preserve existing function permissions; the new read-only projection is restricted to `service_role` with an empty search path.

The interface changes repair Text replies and Unread filters in the owner account preview, prevent background support reads from replacing a foreground selection, invalidate pending private reads after authorization loss, and keep stale completions from releasing a newer loading state. Shared workspace updates isolate failing subscribers and prevent an aborted connection from processing late frames or scheduling another reconnect loop.

Offline tests exercise repeated scheduler polls, blocked queues larger than the selection limit, independent discovery/text progress, capacity recovery, unknown spending holds, private database permissions, monitor priority and disclosure, support response ordering, session loss, stream replacement, and route filter validation. They do not call paid providers or send customer messages.

The production audit also found nine older call receipts still unresolved and a saved export HTTP 500 without a usable export receipt. These fixes do not claim those provider outcomes or costs are known. Original evidence and holds remain available for reconciliation; an empty provider lookup is not proof that an operation was free or never happened.
