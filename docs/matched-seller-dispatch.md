# Matched seller dispatch

The seller allocator can share an inbound request with up to three buyers on its existing schedule. Dispatch previously applied the cold-outreach inventory lock again, so the second paid match could never reserve its original SMS or call while the first buyer held that lock.

`icash_claim_inventory` now recognizes an existing recorded match only when the account, screening, property, submitted phone and current source evidence agree. It does not create an assignment or transfer the cold inventory claim. Suppression, manual takeover, outbound ownership and another matched buyer's completed purchase still deny contact. Final channel admission, credits and provider idempotency are unchanged; no hours or new consent receipts are added.

Unmatched inventory still uses the original exclusion logic. Its phone expression uses `[+]` to accept E.164 without ambiguous backslash escaping.

The database-only migration changes no queued message, call, provider receipt or payment. Existing workers retry never-dispatched work through the same atomic channel claims. The regression test reproduces both SMS and voice reservation failures with the actual upstream SQL, then exercises shared matches, source mismatches, expiry, suppression, signed purchases and cold inventory isolation locally. No paid simulations are used.

The companion monitoring migration retires the old overnight SMS exemption. Since verified inbound sellers have no contact-hour window, a missing first text must remain visible at any hour. Explicit future call appointments still count as scheduled work.
