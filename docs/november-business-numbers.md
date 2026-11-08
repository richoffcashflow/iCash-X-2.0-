# Four November business numbers

The owner requested (646) 295-9838, (862) 381-2530, (786) 672-7869 and
(646) 249-4809, with the provider's warning against overnight bursts.

The release registers these exact numbers for the existing private connection
screen, text pool, caller selection and receipt-backed callbacks. Installation
leaves SMS disabled and writes no provider readiness. Connect each number only
after the matching web release: it checks its active Contiguity lease, forwarding
to the existing AI reception, and exact Twilio caller-ID ownership. A number
awaiting caller-ID verification can receive calls and can be separately enabled
for texts after active forwarding is confirmed; outgoing calls remain disabled.

Each new number admits at most 100 cold texts per rolling 24 hours, 10 per rolling
hour, and one every five minutes. Cold sends also require 9 AM–9 PM Eastern,
in addition to existing recipient-local hours. These limits have no automatic
expiry. Actual requested conversations retain the existing transactional rules
and shared 1,000-total ceiling. All channels use the same atomic physical-number
counter; waiting takes no customer credits. Unknown sends are never replayed.

Apply both reviewed migrations before activation. Publish and verify the exact
release, connect all four through `/messagingadmin/calls`, then enable only the
numbers with fresh successful provider checks. Read back forwarding, SMS and
caller-ID status independently. Preserve older conversation identities and
original receipts; removed leases must not be replaced inside an existing thread.
No development calls, text messages, new leases or provider billing changes are
part of this release.
