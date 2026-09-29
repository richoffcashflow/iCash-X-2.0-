# Customer-funded execution and owner reply verification

Pricing policy: standard cost components target 5x; ElevenLabs alone targets 3x. Each new reservation stores its multipliers and checks the actual customer price (including fractional SMS pricing) against buffered component estimates. Known cost overruns retain a kill switch. Wallet reservations, daily customer limits, permission checks, Pause and idempotency remain mandatory.

Company cash reserves are a configurable requirement. The production switch remains unchanged: automatic approval review rejected globally disabling reserves and enabling automation before rates and queued work were verified. No fictional cash was credited. The policy migration installs the requested option without globally activating it.

The owner diagnostic is separate from customer acquisition. Only service-authorized practice threads can receive up to six replies during a short session. Signed inbound events trigger one-use claims, conversation history goes to the same SMS analysis model, only fixed qualification questions can send, and the reply is labeled practice. STOP suppresses sending; human/callback requests acknowledge pending review and end the session. No callback booking, offer or contract is claimed. Unknown provider costs remain NULL; no customer credits are debited. Delivery receipts attach to the real thread.

Tests: rollback database fixtures cover 5x/3x mixed costs, zero company cash with funded customer credits, below-floor rejection, wallet exhaustion, Pause, replay protection, diagnostic authorization, session cap and service-only permissions. TypeScript checks pass. No paid external call is required by these fixtures.

Remaining launch dependencies include valid discovery/enrichment/voice/SMS/AI rates, actual cost reconciliation, production signing configuration and a verified full funded customer journey. Deploying these files does not prove those journeys work.
