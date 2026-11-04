# Terminal carrier receipt recovery — November 4, 2026

Two completed, unpaid outbound calls had actual inclusive ElevenLabs USD and completed recording receipts, but no original Twilio destination-price snapshot. Their calls ended on October 26 and October 28. The collector correctly refused to substitute today's tariff outside the original 24-hour pricing window; that refusal also prevented recovery from an actual carrier invoice receipt.

When an exactly bound completed call has no snapshot and its original pricing window has elapsed, the collector now accepts the canonical Twilio Call's explicit USD connectivity debit. It retains the original account, operation, conversation, agent, call SID, destination hash, originating number and reviewed policy hash. A free Basic Lookup with no `Fields` packages proves the destination country against the original allowed countries. It never queries a current tariff for this recovery. Missing price, non-USD currency, positive credit values, malformed decimals, conflicting identities or costs beyond the original per-minute ceiling stay held.

The alternate receipt is saved through the existing service-only, first-writer-wins snapshot RPC with `source: twilio_call_receipt`. It contains the canonical price, duration, terminal time, collection time and country source. Every retry reads back and validates the saved receipt. Original tariff snapshots and completed financial manifests remain unchanged. A competing original tariff snapshot wins without being replaced; an older runtime encountering the alternate shape fails closed.

Twilio Call.price covers connectivity only. The collector therefore retains the original separately reviewed stream estimate, recording and storage costs, speech costs, overhead, actual inclusive ElevenLabs USD, all 16 cost categories, saved multipliers and original customer charge ceiling. The combined connectivity-plus-stream component remains labeled estimated. Carrier receipt collection can proceed while AI USD is unavailable, but customer settlement still requires that original USD receipt and complete costs. Historical quota-failed AI calls with missing USD are not settled by this change.

The existing billing-only queue can retry a reviewed original call after the matching production release is verified. Recovery never redials, sends a message, changes customer Run/Pause, extends recipient permission, adds wallet funds, releases an unknown operation or rewrites a previous charge.

## Verification

Offline coverage checks expired-window actual USD, preserved tariff snapshots, exact country and identity bindings, first-writer readback, changed receipt rejection, unknown-AI collection without settlement, late AI receipts, recording requirements and complete-cost settlement. Existing carrier, decimal-normalization and PostgreSQL snapshot access tests remain required. No paid provider demonstration is needed. Successful fixture results do not prove the two providers currently expose usable canonical receipts; verify ordinary receipt-only recovery and the ledger before reporting those accounts recovered.

## Provider references

- [Twilio Call resource](https://www.twilio.com/docs/voice/api/call-resource): terminal Call.price is connectivity only and may arrive after completion.
- [Twilio Basic Lookup](https://www.twilio.com/docs/lookup/v2-api/formatting-validation): requests without Fields are free; country validation is not ownership or contact-consent evidence.
- [ElevenLabs conversation details](https://elevenlabs.io/docs/api-reference/conversations/get): collect the original conversation metadata and inclusive USD rather than converting credit units.
