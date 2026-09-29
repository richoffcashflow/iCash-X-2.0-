# Seller SMS property handoff and opener experiments

SMS analysis now receives fresh server-owned property screening context. Production seller threads resolve context through their own deal and screening record. Owner practice threads can bind a completed, address-matched property check from the same account. Only address, fetch time, preliminary seller ceiling and title-review flag reach this context. No new owner lookup is performed.

Two fixed, non-binding questions can be sent automatically: price flexibility and payoff obligations. Missing/stale property context, invalid ceilings, missing title flags, and repeated questions block those actions. These questions neither quote nor approve an offer. Normal opt-out, human handoff, permissions, Pause, daily budget and dispatch controls remain.

The opener experiment assigns one variant per seller thread, with clear AI identification. The worker queues an opener only for an existing authorized, unpaused auto-mode seller thread attached to a fresh financially eligible screening, during local daytime hours. Sender dispatch still uses the existing cost/permission checks. No launch flags or contact permissions are enabled by this migration. Private practice threads are excluded from automatic outbound acquisition.

Two versions begin balanced. After both versions reach 100 delivered messages with 72 hours to respond within the same account, 80% allocation favors the highest smoothed non-opt-out response rate and 20% continues exploration. Delivered status and actual incoming messages drive metrics. Response is not positive interest or a contract. Explicit opt-out/Not interested messages are excluded from winning responses. This is an initial reply experiment, not evidence of improved contract rate or a statistically proven winner.

Voice/callback requests still use the existing handoff path; SMS cannot claim appointments booked. Contract creation and signatures require their own verified workflow. No production launch or completed deal is implied by this release.
