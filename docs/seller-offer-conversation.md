# Qualified seller cash offer

Owner requested October 7, 2026, at 11:30 PM America/Chicago: confirm selling interest, ask what is happening with the property and why the seller wants to sell, confirm missing property facts, then present the calculated cash price with an as-is, all-cash explanation.

Outbound receives the current calculated cash proposal plus its repair estimate. An existing approved agreement keeps its exact agreed price. The conversation asks one question at a time, skips answered questions, confirms material condition and timing, and pauses after presenting the offer. Holding and resale costs are general pricing considerations, not invented itemized deductions. New contradictory condition or payoff information requires updated numbers.

Inbound uses the separately reviewed `seller_offer_v2` script. The existing exact call, account, property and current SMS focus checks select the research. The server recalculates the same fresh screening formula and financial eligibility used by outbound. Only a positive nonbinding cash proposal and repair estimate are passed to the voice provider. Raw research, private owner details, debts, fees and internal ceilings stay on the server. Stale research, pending purchase agreements, ambiguous records and financial holds do not produce a new price quote. Buyer calls retain their existing buyer price and role behavior.

Inbound can discuss the proposal and the seller's response; it does not gain contract sending, signing, payment or scheduling tools. Outbound retains its existing contract delivery tools and checks. Recording remains active with the direct property opening.

The production preparation script creates a zero-traffic provider branch and stages a disabled version. Activate only after the production build is ready and the existing call has ended. The candidate retains the original funding and duration limits. Staging checks that the existing carrier settlement estimate is present, preventing recurrence of the missing billing configuration from the preceding renewal.

Validation includes exact offer arithmetic and field filtering, absent/stale/wrong-property/financial-hold research, pending agreements, unchanged buyer routing, separately bound old and new script hashes, provider staging, recorded call service checks, and a real SQL call-to-property-to-proposal regression. A live caller test remains necessary to assess the conversation and audio.

Return calls retain the last bound SMS property for up to 30 days after its incoming message, independently of the two-hour SMS reply-attribution window. The exact account, phone, route revision and source message must still match. Another property's outbound contact, a routing conflict, a retired or paused thread, or an ambiguous buyer/seller role prevents reuse. No SMS expiration, message or caller statement is rewritten.

Seller and buyer greetings use only the first name attached to the matched account, property, role and phone. Seller names come from the assigned inquiry; buyer names require a current buyer contact and candidate for that deal. Company names, placeholders, invalid names and conflicting identities use a plain greeting. The greeting establishes neither identity nor ownership. Existing buyer script, price and contract checks remain in place.
