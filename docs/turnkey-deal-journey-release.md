# Buyer-to-closing journey

New buyer requests create a durable, account-scoped next step. Existing requests are not replayed into outbound work. A private buyer link collects legal buyer/signatory details and a funds-availability statement, or lets a buyer select seller-provided viewing options. These statements do not verify funds or sign an agreement.

Assignment preparation serializes buyers for the same deal, preserves published pricing, and uses the existing reviewed signing templates and paid-operation controls. The buyer signs first; the owner still reviews and signs. Only a verified deposit receipt reserves the property. The original assignment has no deposit due date, so a date is recorded only from an agreed source.

Private seller links collect exact availability and confirm a specific visit. Both confirmations are required. Rescheduling resets both. Version checks prevent stale confirmations and stale reminders. The scheduled worker sends at most two texts and prepares at most one assignment per run; existing permissions, contact routing, opt-outs, credits, holds and live-work flags still apply. There are two unanswered-buyer reminders. Unknown sends are reconciled, never blindly retried.

Closing preferences reuse the legal payee, payout preference and previously verified title proposal. A different deal still needs title coverage/party agreement and secure payment-detail confirmation. Existing title discovery, opening, document updates and follow-ups remain the transport for closing work.

Call, text and closing handoffs stay visible after assignment and require a resolution. Owners receive their enabled account alerts. Returning control releases only a resolved human-request hold; it does not remove opt-outs or other later holds.

Verification: seven grouped local PostgreSQL scenarios, including competing/repeated requests, privacy, exact quoted amounts, signing/deposit/title progression, two-party viewing, rescheduling, profile reuse, inbound handoffs and uncertain delivery. Local transport checks prohibit provider network calls and test one-time dispatch and preview/test isolation. Existing offer, deposit, contract-text and closing scenarios and the production build also pass. No paid provider simulations were used.
