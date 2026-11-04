# Verified outbound calling for the new business numbers

The owner requested outgoing calls from +14154208230 and +16195364770 after
their incoming forwarding setup. This change permits both numbers only after
the existing live provider checks confirm an active lease, the exact Twilio
account/caller-ID receipt, active forwarding and the approved reception route.
It does not verify caller IDs, start calls, enable provider billing or enable SMS.

## Routing

The four-argument `icash_business_conversation_sender` holds the existing shared
recipient/account/history checks. Its voice flag only allows these two exact
numbers past the SMS-enabled pool filter. Every additional number still requires
the voice registry's outbound, forwarding and caller-ID readiness. The existing
three-argument selector remains the SMS entry point; only the existing automatic
and manual/browser call wrappers request voice mode.

An established SMS conversation keeps its original caller. A conversation that
starts with a new voice-only number keeps that number for later calls. Its texts
remain held while that sender is disabled; they never rotate to another number.
The disabled older +14244377030 number receives no exception. No historical
thread, call identity, recipient suppression, unknown outcome or Pause is changed.

Connecting either new number preserves its disabled SMS sender row. The save RPC
also creates that row disabled if absent. Existing sender choices remain intact.

The callback number allowlists and owner lookup include both new numbers. The
companion receipt-only callback migration recognizes a real prior seller AI call
or manual/browser child-call receipt even without a text thread or deal draft.
Manual calls also require positive, exact seller-source evidence. Alternatives
are counted before readiness checks; ambiguous accounts, unknown roles and held
routes cannot select or charge a customer by elimination.

A callback keeps the matched customer's wallet and exact approved reception
template. A call-only session binds account, screening, business number and its
optional deal to fresh receipt-backed candidates. Later ambiguity, a new thread
or draft, changed controls or missing evidence invalidates that binding. Context
contains only the public property address; it does not fabricate SMS history,
prove ownership or grant agreement/SMS tool authority. Existing threaded routes
and their controls remain intact.

## Release and activation

1. Confirm both caller IDs through Twilio's normal ownership verification. Merely
   listing the Contiguity leases or incoming forwarding does not prove this.
2. Apply `verified_outbound_business_numbers`, then `receipt_only_seller_callbacks`
   against the reviewed current predecessors. They fail atomically if a patched
   boundary has changed. Do not replay unrelated historical migrations.
3. Publish the matching web/worker release after its exact release checks pass.
4. In `/messagingadmin/calls`, select each number and choose **Connect calls**.
   This performs fresh provider checks and stores readiness; no calls are sent.
5. Read back exact phone/account/caller-ID, `forwarding_ready=true`,
   `outbound_enabled=true`, and both SMS sender rows still `enabled=false`.

If either caller ID is absent, forwarding is queued/revoked, or the reception
route is wrong, leave outgoing calls disabled. Never bypass verification or send
paid development calls. Existing funded production work remains subject to its
normal recipient, recording, pricing, credit, capacity and Pause controls.
