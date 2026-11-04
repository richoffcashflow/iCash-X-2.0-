# Seller clarification call duration

The November 4 owner call entered the financial-clarification path and received a 120-second authorization; its saved recording ended after 119 seconds. This was separate from wallet exhaustion. The account still had positive credits.

New clarification calls now start from the normal reviewed 600-second ceiling. Existing prospecting capacity, rates, actual-zero balance termination, Pause, consent, financial screening and final admission remain intact. Existing operation bounds are immutable and are never extended or replayed. Clarification still cannot authorize an offer, negotiation or contract. The prompt removes the 90-second target and requires a clear goodbye after answering the seller's clarification questions.

The migration patches exactly one loop in the installed reservation function and preserves intervening pricing and eligibility changes. It is compatible with the existing web/worker: they already pass the persisted duration to the carrier. Apply the migration after its PostgreSQL fixture passes; release the prompt through exact-head and exact-main CI. Verify the installed function and unchanged historical call bound with read-only queries. Do not place paid test calls or resubmit the failed demonstration.

Offline regression covers fresh 600-second clarification, original 120-second operation replay, zero-credit admission, actual-zero termination, financial hold preservation and duplicate-reservation protection. Provider duration records establish the original cutoff; they do not prove a future live conversation has completed successfully.
