# Owner demo call routing

The November 10 owner demo was assigned a newly enabled texting lease whose outbound caller ID was not verified. Text preparation saved that sender before voice dispatch, so the shared conversation identity correctly prevented calling from another number. The reset had cleared old properties but had not checked this new allocation.

For a new private owner demo with its actual account-bound call-now form receipt and voice enabled, the first texting allocation now requires both enabled texting and verified outbound calling. Selection still uses the shared recipient, suppression, tenant and role checks. A missing dual-channel number leaves text preparation unassigned, allowing the existing independent voice path and its normal final checks to decide whether a call can start.

This change is limited to the exact presenting owner and assigned demo. Ordinary customers, buyer texting, SMS-only choices, existing threads and recorded calls keep their original routing. It never activates a number, changes caller-ID evidence, renews the five-minute call request, retries a provider attempt or modifies funds. Historical demo failures remain original evidence.

The database-only guarded patch is compatible with the existing web and worker callers. Apply the matching migration only after the routing regression passes. Verify the deployed function, candidate pool, original request expiry and owner account state separately from actual handset delivery. A passing configuration check does not prove that a phone rang.

Validation: `node --experimental-strip-types tests/owner-demo-call-capable-routing.test.mjs` loads the actual routing migration chain and covers the failed SMS-only first allocation, two-channel selection, established and unknown call identity, missing consent/source bindings, other accounts, voice disabled, number disable, opt-outs and migration drift/idempotence.
