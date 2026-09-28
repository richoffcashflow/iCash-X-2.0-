import assert from "node:assert/strict";
import { checkFreeAllowance } from "../lib/free-allowance.ts";

const baseline = {
  grant: { allowedOperations: ["property_research", "property_analysis"], maxOperations: 3, maxProviderCostCents: 80, dailyProviderCostCents: 30 },
  usage: { operationCount: 1, lifetimeProviderCostCents: 20, todayProviderCostCents: 10 },
  operation: "property_research", estimatedProviderCostCents: 15,
  signedIn: true, paused: false, providerReady: true, permitted: true,
};
assert.equal(checkFreeAllowance(baseline).allowed, true);
assert.equal(checkFreeAllowance({ ...baseline, signedIn: false }).allowed, false);
assert.equal(checkFreeAllowance({ ...baseline, paused: true }).allowed, false);
assert.equal(checkFreeAllowance({ ...baseline, providerReady: false }).allowed, false);
assert.equal(checkFreeAllowance({ ...baseline, permitted: false }).allowed, false);
assert.equal(checkFreeAllowance({ ...baseline, operation: "seller_call" }).allowed, false);
assert.equal(checkFreeAllowance({ ...baseline, usage: { ...baseline.usage, operationCount: 3 } }).reason, "free allowance used");
assert.equal(checkFreeAllowance({ ...baseline, estimatedProviderCostCents: 61 }).reason, "free allowance used");
assert.equal(checkFreeAllowance({ ...baseline, estimatedProviderCostCents: 21 }).reason, "daily free limit reached");
assert.throws(() => checkFreeAllowance({ ...baseline, estimatedProviderCostCents: -1 }), /Invalid/);
console.log("free allowance checks passed");
