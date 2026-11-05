# Initial seller replies and independent buyer work

A production review found received text/busy acknowledgements after a delivered
ownership opener with no seller reply job. The existing conversation planner
correctly required ownership context, but there was no bounded way to ask for it
for these messages. The reviewed examples did not establish ownership, agreement
to sell, offer authority or a callback request.

The prospective SQL patch recognizes complete text requests or cannot-talk
acknowledgements. It requires the exact account/thread's delivered original
ownership question, an unresolved ownership opening, no intervening outgoing
operation and both source timestamps after activation. It reuses the existing
`clarify_ownership` action, one-output behavior, repetition limit and final-send
checks. Opt-outs, refusals, customer control, financial/contact checks, route
changes, stale sources and unknown delivery outcomes remain effective. It does
not change calling preferences, book a callback, infer ownership or replay old
inbound events.

`20261105074935_seller_initial_reply_clarification.sql` checks the exact current
context definition before changing one branch. Install only this reviewed SQL;
do not push unrelated pending migration history. It preserves function ACLs and
existing row security. The existing application understands the resulting
dialogue job, so no new API contract is required. Read back the migration receipt,
function definition and activation timestamp. To disable the new behavior, clear
`icash_seller_progress_settings.initial_reply_enabled_at`; final admission will
also reject unclaimed new clarification outputs. Do not reset the timestamp to
include historical source messages.

An independent buyer journey could also fail before another message was claimed.
The service now isolates selection, individual journey progression and message
dispatch. It preserves the maximum five properties, one assignment attempt, one
eligible title attempt and two message claims. It does not repeat a failed claim
or dispatch the same message twice in one run. Uncertain operations remain owned
by the original database records. A denied property no longer consumes another
eligible property's title slot, and a late assignment failure cannot overwrite a
newer closed, cancelled, reserved or deposit state.

Internal results distinguish accepted/delivered messages from held attempts and
return a failing cron status when processing requires review. Only fixed stage
names reach logs; raw provider errors and message contents do not.

Verification uses the exact captured production context in an isolated database,
reproduces the original null route, checks the actual trigger/resume/final-claim
flow and disabled/history behavior, and exercises 16 concurrent webhook events,
recoveries and final claims in native PostgreSQL. Journey fault tests execute the
real service and authenticated cron route with explicit transport failures. No
paid provider requests, customer replays or live signing simulations are tests.

These changes do not fix the separately tracked general scheduler timeout or
establish that any customer has completed a live signing-to-closing journey.
