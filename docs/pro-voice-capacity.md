# Pro call capacity

The owner approved 1,000 conversations per day for the shared outgoing agent and twenty concurrent calls across iCash X on October 26, 2026. Eighteen slots are available to outgoing calls, with two reserved for incoming calls. The incoming agent keeps its current configuration and daily limit.

Apply the `pro_voice_capacity` migration before deploying the compatible application. It raises only the ceilings in the existing capacity saver, final admission check and scheduling shortcut. Existing observed limits remain unchanged until normal provider reads verify the new limits. Incoming reservation, account fairness, original call settlement, contact checks, credit exhaustion, wallet admission and uncertain-operation holds remain intact.

After the release passes the exact main-commit reliability gate and becomes live, authenticated production maintenance applies the provider setting once. It checks the current subscription, exact reviewed agent/branch/version, unchanged full configuration and current limits of eight concurrent calls and 100 daily conversations. A durable database claim permits one minimal PATCH to eighteen and 1,000, followed by exact readback. An uncertain write is only reread; it is never automatically repeated. The completion receipt survives later capacity observations and manual changes.

The old and new approved configurations both remain recognized, so the settings are changed after compatible code is serving. Saved fingerprints, prompts, voices, tools, recording approvals, pricing, burst mode and credit overage settings are preserved. No paid test calls or simulations are run.

Verify `icash_pro_voice_capacity_change('status')` reports `applied`, capacity observations report twenty total and eighteen outgoing, and provider metadata reports the outgoing daily cap of 1,000. The incoming cap remains two simultaneous calls. An unresolved claim or configuration mismatch requires investigation of the original readback, not another PATCH.
