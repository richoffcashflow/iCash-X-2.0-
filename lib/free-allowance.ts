/** A server-side gate for a real, finite free bot run. Values come from versioned admin configuration. */
export type FreeOperation = "property_research" | "property_analysis" | "owner_enrichment" | "seller_call" | "seller_message";
export type FreeGrant = {
  allowedOperations: FreeOperation[];
  maxOperations: number;
  maxProviderCostCents: number;
  dailyProviderCostCents: number;
};
export type FreeUsage = { operationCount: number; lifetimeProviderCostCents: number; todayProviderCostCents: number };
export type FreeDecision = { allowed: boolean; reason: string; remainingOperations: number; remainingProviderCostCents: number };

const cents = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function checkFreeAllowance(input: {
  grant: FreeGrant;
  usage: FreeUsage;
  operation: FreeOperation;
  estimatedProviderCostCents: number;
  sessionEligible: boolean; // server-issued, rate-limited grant; no customer account required
  paused: boolean;
  providerReady: boolean;
  permitted: boolean;
}): FreeDecision {
  const { grant, usage } = input;
  if (![grant.maxOperations, grant.maxProviderCostCents, grant.dailyProviderCostCents,
    usage.operationCount, usage.lifetimeProviderCostCents, usage.todayProviderCostCents,
    input.estimatedProviderCostCents].every(cents)) throw new Error("Invalid free allowance");
  const remainingOperations = Math.max(0, grant.maxOperations - usage.operationCount);
  const remainingProviderCostCents = Math.max(0, grant.maxProviderCostCents - usage.lifetimeProviderCostCents);
  let reason = "";
  if (!input.sessionEligible) reason = "eligible session required for live work";
  else if (input.paused) reason = "bot paused";
  else if (!input.providerReady) reason = "provider unavailable";
  else if (!input.permitted) reason = "operation not permitted";
  else if (!grant.allowedOperations.includes(input.operation)) reason = "operation outside free allowance";
  else if (remainingOperations === 0 || input.estimatedProviderCostCents > remainingProviderCostCents) reason = "free allowance used";
  else if (input.estimatedProviderCostCents > Math.max(0, grant.dailyProviderCostCents - usage.todayProviderCostCents)) reason = "daily free limit reached";
  return { allowed: !reason, reason, remainingOperations, remainingProviderCostCents };
}
