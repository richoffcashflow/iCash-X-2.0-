# Seller listing clarification — November 17, 2026

A recorded seller answered “It can be with you” when asked whether the property was currently agent-listed. The agent announced a listing exclusion and said it had saved that status. The private source event instead contained the exact ambiguous reply, a generic changed-facts hold, and no `listedWithAgent` value. The existing listing parser already returned unknown for this phrase. The completed-call outcome parser does not turn the agent's assertion into a listing fact.

The saved core prompt told the agent to announce the exclusion and then save the answer. The new application runtime wording requires the source-bound `report_change` result first. Only `listed_with_agent` authorizes that explanation. A blocked price or a changed-facts hold is not proof of listing.

## Narrow behavior

For the complete “It can be with you” or “It could be with you” reply to the latest positive listing question, the tool returns a cash-purchase/current-listing clarification while listing is still missing. It does not save a listing or manufacture a material property change. Repeated prospective replies get an explicit unresolved response instead of another question. A subsequent actual yes still blocks the offer; a no allows the existing qualification and financial gates to proceed. Existing property, payoff, condition, listing and issued-agreement holds remain.

This is deliberately not a general exemption for unmatched replies. Mixed ownership/debt changes, other ambiguous statements, stale tool arguments and refusals retain their source and authority checks. No past record is rewritten or replayed.

## Runtime scope and verification

Normal automatic-offer seller calls receive the replacement through application prompt composition before the existing 24,000-character history budget. It replaces only the anchored original listing instruction line and preserves JSON-quoted seller history. Matched inbound seller role instructions receive the same wording. Buyer, intake, limited, cancellation, unknown and ambiguous roles retain their existing scope. Frozen provider policies, hashes, tools and account settings are unchanged.

`tests/seller-listing-clarification.test.mjs` replays the exact reply through the actual cash-offer POST handler with synthetic source/provider boundaries, connected yes/no corrections, repeated ambiguity, original holds and source-argument mismatches. It verifies inbound roles and captures the actual outbound registration request without network traffic. `tests/live-dispatch.test.mjs` exercises the real outbound assembly with long prior-call history, confirming both the limit and retained whole seller details. The local release registry includes the new suite.

The candidate needs the usual reviewed application deployment, without a database migration or provider configuration write. It is independent of the separate future-listing-parser correction. No live paid call, message, agreement or external contact was used to validate it. These tests establish deterministic tool behavior and the supplied runtime instructions, not that a language model will always speak correctly. Later source-bound production evidence is required to assess that result.
