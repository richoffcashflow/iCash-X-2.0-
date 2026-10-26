Seller follow-up and conversion recovery
======================================

Outbound no-response reminders previously waited 24 hours while their contact observations expired 24 hours after the original lookup. The recovery check also only accepted inbound intake permission. This release supports outbound threads through the existing reviewed SMS contact path and schedules a single continuation four hours after the delivered question. The existing seven-day/24-hour repetition limits, final dispatch checks, wallet admission, quiet hours, pause, STOP and uncertain-send holds still apply.

Apply `20261026175235_seller_followup_window.sql` after the outreach receipt-priority migration. It changes no contact receipt, consent, provider limit or wallet. Expired, unsent operational reminders become `needs_review` with `contact_checks_expired`, preserving their original source and quote. The workspace explains that fresh checks are required. Recording a resolution does not grant contact authority. Queued or uncertain sends are not replayed.

The root scheduler checks due original signing/call receipts first, then active replies and due title/fulfillment work, then one eligible follow-up per minute, then resumes its existing new-work paths. This stops continuous prospecting from starving follow-ups while preserving receipt settlement and active-deal priority.

Seller price requests now establish willingness to discuss an offer without repeating availability and interest questions. They do not establish ownership, condition, occupancy, listing status, acceptance or price authority. Outbound runtime guidance ends explicit voicemail and disconnected-number greetings promptly and distinguishes call screening from a human seller. Frozen reviewed provider configuration remains unchanged. Concise repeated guidance preserves room for actual saved seller answers within the existing 24,000-character limit.

Validation uses synthetic local database fixtures, saved-call scenarios and dispatch tests. No paid test call, message, data lookup or buyer qualification is created. Buyer qualification, verified title contacts, actual signatures and received proceeds still require their original real evidence. Customer purchase/account claims remain authenticated; this release does not auto-link customers by name or email alone.
