# Four November business numbers

## November 11 additions

The owner added (602) 772-2055 and (435) 724-2174 to the same pool.
`november_11_business_numbers` extends the exact-number routing boundaries and
installs both SMS rows disabled. `november_11_sender_pacing` gives both the
existing 200/day, 20/hour, three-minute spacing and daytime policy, preserving
usage counters, health routing and all previously disabled numbers.
After the matching production release, connect each from `/messagingadmin/calls`
and confirm its active lease and forwarding before enabling its SMS row.
Outgoing calling remains dependent on verified Twilio caller ID. Connection
checks do not send texts or place calls, and do not prove end-to-end delivery.

## November 10 additions

The owner added (505) 601-9451, (505) 507-2937 and (512) 779-1343 to the same
pool. `november_additional_business_numbers` extends only the existing exact
number boundaries and installs these three SMS rows disabled. The separate
`november_additional_sender_pacing` migration applies the existing 200/day,
20/hour, three-minute spacing and daytime policy to all three. Prior usage,
disabled lines, conversations and caller-ID verification requirements remain.
After the matching production release, connect each from the existing Calls
screen, confirm its active lease and forwarding, and then enable its SMS row.
Outgoing calls require an actual verified Twilio caller ID; registration alone
does not prove calling or text delivery.

If the forwarding update loses its response or returns malformed data, the
connection action makes one fresh readback without repeating the update. Only
the exact active lease, reception and destination checks can save readiness;
a queued result remains pending. Owner-only errors identify the provider step
without exposing response values or credentials. An unresolved update leaves
the number held. This does not clear any separately disabled or carrier-blocked
SMS sender.

Live verification of (505) 507-2937 exposed an eight-second timeout in the
forwarding update. Explicit setup now allows thirty seconds for that one POST;
ordinary provider reads retain their eight-second bound. The owner action has
matching browser and route budgets for precheck, update, readback and save.
Timeouts still trigger only a readback, never a second update or false readiness.

## Original November 8 additions

The owner requested (646) 295-9838, (862) 381-2530, (786) 672-7869 and
(646) 249-4809, with the provider's warning against overnight bursts.

The release registers these exact numbers for the existing private connection
screen, text pool, caller selection and receipt-backed callbacks. Installation
leaves SMS disabled and writes no provider readiness. Connect each number only
after the matching web release: it checks its active Contiguity lease, forwarding
to the existing AI reception, and exact Twilio caller-ID ownership. A number
awaiting caller-ID verification can receive calls and can be separately enabled
for texts after active forwarding is confirmed; outgoing calls remain disabled.

The owner's November 8 follow-up raises each of these four numbers to at most
200 cold texts per rolling 24 hours, 20 per rolling hour, and one every three
minutes: 800 cold texts per rolling day across the four. Cold sends require 9 AM–9 PM Eastern,
in addition to existing recipient-local hours. These limits have no automatic
expiry. Actual requested conversations retain the existing transactional rules
and shared 1,000-total ceiling. All channels use the same atomic physical-number
counter; waiting takes no customer credits. Unknown sends are never replayed.

`november_sender_200` updates both the exact-number pacing gate and its shared
daily baseline, so the older 100/day baseline cannot silently block the requested
capacity. Other numbers retain their existing 100/day baseline and verified-reply
qualification for 300/day. These four stop at 200 even with a qualifying cohort.
Apply this guarded migration after the original pacing migration; it changes no
usage counters, contact evidence, queued messages or number enablement. The
hourly and spacing changes let 200/day fit within the existing daytime window.

Apply both reviewed migrations before activation. Publish and verify the exact
release, connect all four through `/messagingadmin/calls`, then enable only the
numbers with fresh successful provider checks. Read back forwarding, SMS and
caller-ID status independently. Preserve older conversation identities and
original receipts; removed leases must not be replaced inside an existing thread.
No development calls, text messages, new leases or provider billing changes are
part of this release.
