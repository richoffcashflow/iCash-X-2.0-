# Seller call confirmation continuity

The November 11 owner report identified repeated confirmations and slow delivery of the offer during a live seller call. Saved evidence showed a mortgage answer followed by an additional-debt answer, but only the latter reached offer state. Runtime guidance also repeated acceptance and closing instructions.

The fix applies prospectively to ordinary seller calls:

- If the mortgage save was skipped, the next other-debt report can recover it only from the immediately preceding seller answer and its actual question in the same bound history. It cannot scan past a correction, unknown answer or another seller response. A newly reported balance still invalidates old shortfall coverage and acceptance.
- A verified routine initial negative co-owner answer preserves an already saved price acceptance. It does not verify signers, clear a prior hold, upgrade conditional acceptance, or change an issued agreement. Actual ownership or price changes retain the original stops.
- Runtime instructions for inbound and outbound calls reuse answers, save an explicit price acceptance immediately, combine the missing sole-owner/decision-maker question, and give one concise final price/calendar-date/inspection-period readback with text permission. Missing or changed terms still need actual answers. Repeated technical failures get one explanation after the existing bounded retry.
- Accepted offers with reported debt no longer instruct the assistant to obtain the same price acceptance again.
- The targeting qualification observation runs through Next.js `after`, following the live HTTP tool response. Qualification, bound context, current-price persistence and other authorization checks remain awaited. The Meta offer-authorized update remains synchronous because it also controls duplicate follow-up calls.

The frozen provider policy hashes, provider settings, UI, phone routing, balances, automatic research controls and original call/contract receipts are unchanged. No database migration or provider reconfiguration is required. Release verification must cover the web application and the worker that builds outbound call prompts.

Offline regressions exercise the actual offer and agreement services with fictional data: skipped mortgage saves, unknown/corrected balances, additional debt, retained price acceptance, conditional acceptance, existing material holds, changed ownership, issued agreement revisions, one final spoken readback and text permission, deferred bound reporting, and inbound/outbound instruction assembly. Existing identity, withdrawal, price-change, signing and duplicate-delivery tests remain required. These tests verify code and instruction contracts; they do not establish live voice quality, measured latency, or real agreement delivery. No paid provider simulation or historical outreach replay is part of this repair.
