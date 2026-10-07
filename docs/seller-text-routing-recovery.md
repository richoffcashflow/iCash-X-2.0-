# Seller reply routing recovery

An incoming ownership confirmation was saved without a property because two consented property threads shared the same number. It never reached the seller conversation engine. This change adds the missing clarification and immediate processing around the existing bounded AI conversation workflow.

For ambiguous messages, the system may send one short address question using an eligible consented seller thread as transport. The original incoming message remains unassigned. The exception admits only the exact address question, with no attachments, current routing revision, normal consent, financial, manual, suppression, hours and cost checks. It never discloses candidate addresses or infers terms from the transport thread. Clarifications are limited to six per hour and cannot repeat a sent question within two minutes.

An explicit incoming street address establishes a two-hour conversation context, allowing subsequent short replies on that same property. Another property's outgoing message, a changed routing revision, expiry, or an unknown/multiple address prevents context reuse. Sending a recent opener alone never selects a property. Existing ambiguous history remains unchanged.

The authenticated provider webhook immediately dispatches an already queued reply or promotes that exact incoming message's pending AI job. The existing AI claim handles usage, duplicate processing and safe reply derivation. STOP and delivery events never invoke the reply engine. The existing worker remains the fallback; failed or unknown provider sends are not retried.

This patch preserves the newer seller conversation engine, its callback-review behavior, private offer limits and call budget/provider gates. It does not create appointments, add a redial lane, promise a successful call, modify credits, or reopen paused conversations.

Verification: actual webhook/service fixture tests, isolated SQL routing and immediate-job tests, existing conversation SQL/policy/service tests, and webpack production build. Provider delivery is checked separately after release; fixture tests do not prove a live call or AI model response.

## Missing AI billing configuration

Production also had an enabled SMS AI setting with no `sms_ai` rate, so model claims could not run. `sms-ai-token-billing.sql` separates the existing reviewed nine-cent bundle into its existing one-cent transport estimate at the standard 3x price (three cents), plus actual OpenAI token usage at 3x or VIP 2.4x. It does not add an AI charge on top of the old bundled AI allocation.

The six-cent AI reservation is a cap, not the charge. The request uses the default service tier, at most 44,000 UTF-8 request bytes and 800 output tokens. The server settles the receipt's input, cached-input and output tokens using the official GPT-4.1 mini prices checked October 7, 2026, with fractional-cent carry. Invalid or missing token receipts remain held; they cannot fall back to charging the maximum estimate. The transport estimate remains labeled as such.

Only currently admitted bindings using the exact prior bundled rate adopt the split rate. Delivered message prices, existing reservations, consent timestamps, paused/manual state and expiry holds remain intact. Model-setting changes cannot use this reviewed model's rate. Migrations fail atomically if the expected existing setup changed.

Apply the routing migration, deploy the request-bound application, then apply token billing. This ordering prevents an older application from making requests outside the new reviewed byte bound. The price/rate change is not a credit top-up or spending-cap increase.
