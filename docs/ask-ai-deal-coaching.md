# Ask AI deal coaching

The November 4 audit found that Ask AI paid for a question classifier, then returned canned workspace text. Its context included a short seller call summary but no seller texts, buyer conversations, verified deposit status or prior answer text. Most buttons only opened a property card. Account-wide attention could override a selected property's next step.

The updated assistant produces a concise, structured coaching answer in the existing single metered request: recommended next move, reason, up to three steps, one essential clarification and an optional SMS draft. It covers seller negotiation, buyer objections, viewing coordination, agreements, deposits and closing. Exact activity, balance, work controls and saved offer math retain deterministic answers. A selected property's fallback next step stays about that property. General coaching remains available without choosing a property.

## Context and controls

Detailed context is loaded only for the selected or uniquely matched property. Reads retain server-bound account/deal/thread identities and bounded windows. They include recent seller/buyer texts with original direction, author and delivery state; saved seller call summaries; incoming buyer call summaries; buyer network email replies; current published asking price; signature, viewing and buyer journey state; exact assignment-bound deposit receipts and manual control. Missing reads fail instead of becoming empty history. Email addresses and full call transcripts are not sent in the new context.

The model has no tools. It selects named destinations from a server-built catalog. Unknown properties, threads, action keys, arbitrary URLs and extra response fields cannot create an action. Suggestions open the existing agreement, buyer, viewing/deposit, closing or bot-handoff controls. Current screens and server admission remain authoritative.

“Review & send” opens the exact saved seller/buyer thread with an editable draft. It does not submit a text. The existing composer handles current contact permission, account access, takeover, credits, one-use request keys and delivery recovery. A fresh thread read is required for each suggestion opening. An existing draft or newer message requires explicit review; prior drafts and held sends remain intact. Only the existing Send control transmits. Buyer drafts exclude acquisition terms and unsupported dollar prices, fit the existing single SMS limit, and never add a STOP footer. Practice properties cannot produce send/handoff actions.

The VIP-only dialog uses the established white/black/gold palette, responsive cards, keyboard controls and 44px action buttons. Property conversations are separated in the visible history. A completed response starts at its recommendation, with steps and draft below. Opening Ask AI remains free; only submitted questions use work credits.

## Metering and release

The one guarded migration raises only `icash_settle_question`'s accepted output-token bound from 150 to 1,200. It requires the reviewed predecessor definition hash and verifies the resulting definition and unchanged ACL. The existing 32,000 input bound, fixed model/rates, original multiplier, fractional carry, five-cent reservation, locks, historical receipts and idempotency stay unchanged. Even at 32,000 uncached input + 1,200 output and the historical 3x multiplier, cost fits the existing reservation. Application UTF-8 input has a conservative 28,000-byte ceiling including schema/instructions. Known provider usage is never replaced with an unverified zero if settlement fails.

Install the additive, backward-compatible bound before releasing the web application. Previous 150-token callers remain valid. No worker configuration, provider configuration or paid demonstration is required. Roll back the application first if needed; retaining the larger receipt bound preserves any already-issued coaching receipt. Do not revert it while such requests can still settle.

Validation uses fictional provider responses, context-loader and route fixtures, a PGlite execution of the exact reviewed function/migration, and desktop/mobile browser flows. These checks verify integration and constraints; they do not claim a paid live model-quality evaluation or a completed customer deal. Also correct the support-quality GET handler's optional TypeScript request annotation, which the installed Next.js build rejects; runtime behavior is unchanged.

The prerequisite was installed as migration `20261105043323_ask_ai_deal_coaching`. Production readback verifies function hash `8cd3a2e2301c59a3fa7f5f2506e27bf7`, the 1,200 output bound, unchanged input/charge caps and no anonymous/authenticated execute access. No customer usage was dispatched for verification.
