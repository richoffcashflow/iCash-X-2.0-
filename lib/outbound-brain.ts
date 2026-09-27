/**
 * Pure credit allocation policy. No provider calls, charges, or user data live here.
 * All monetary values are integer cents. The server must reserve and settle funds
 * transactionally with an idempotency key before dispatching a real operation.
 */
export type WorkStage = "closing" | "contract" | "buyer" | "seller_interested" | "follow_up" | "qualification" | "prospecting";
export type CandidateAction = {
  id: string;
  stage: WorkStage;
  customerChargeCents: number;
  estimatedProviderCostCents: number;
  evidenceAt: number; // UTC timestamp from a real event
  dueAt: number;
  permitted: boolean; // policy, consent, quiet hours, and user authorization already checked
};
export type PacingPolicy = {
  maxDailyFundedFraction: number;
  maxDailyBalanceFraction: number;
  protectedFundedFraction: number;
  minimumGrossMarginFraction: number;
  activeProspectingFraction: number;
  maxQueuedActions: number;
};
export const launchPolicy: PacingPolicy = {
  maxDailyFundedFraction: 0.15,
  maxDailyBalanceFraction: 0.12,
  protectedFundedFraction: 0.25,
  minimumGrossMarginFraction: 0.65,
  activeProspectingFraction: 0.3,
  maxQueuedActions: 30,
};
export type AllocationInput = {
  balanceCents: number;
  fundedAmountCents: number;
  userDailyLimitCents: number;
  spentTodayCents: number;
  now: number;
  actions: CandidateAction[];
  policy?: PacingPolicy;
};
export type Allocation = {
  dailyLimitCents: number;
  remainingTodayCents: number;
  protectedForActiveDealsCents: number;
  selected: { id: string; stage: WorkStage; reservedCents: number }[];
  skipped: { id: string; reason: string }[];
};
const weights: Record<WorkStage, number> = {
  closing: 100, contract: 95, buyer: 88, seller_interested: 84,
  follow_up: 68, qualification: 48, prospecting: 20,
};
const activeStages = new Set<WorkStage>(["closing", "contract", "buyer", "seller_interested", "follow_up"]);
const integerCents = (n: number) => Number.isSafeInteger(n) && n >= 0;
const fraction = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;

export function allocateCredits(input: AllocationInput): Allocation {
  const p = input.policy ?? launchPolicy;
  if (![input.balanceCents, input.fundedAmountCents, input.userDailyLimitCents, input.spentTodayCents].every(integerCents) || !Number.isFinite(input.now)) throw new Error("Invalid balance or limit");
  if (![p.maxDailyFundedFraction, p.maxDailyBalanceFraction, p.protectedFundedFraction, p.minimumGrossMarginFraction, p.activeProspectingFraction].every(fraction) || !Number.isSafeInteger(p.maxQueuedActions) || p.maxQueuedActions < 0) throw new Error("Invalid pacing policy");

  const dailyLimitCents = Math.min(input.userDailyLimitCents, Math.floor(input.fundedAmountCents * p.maxDailyFundedFraction), Math.floor(input.balanceCents * p.maxDailyBalanceFraction));
  let remaining = Math.max(0, Math.min(input.balanceCents, dailyLimitCents - input.spentTodayCents));
  const protectedForActiveDealsCents = Math.min(input.balanceCents, Math.floor(input.fundedAmountCents * p.protectedFundedFraction));
  const hasActive = input.actions.some(a => a.permitted && activeStages.has(a.stage));
  const prospectingBudget = hasActive ? Math.floor(remaining * p.activeProspectingFraction) : remaining;
  let prospectingUsed = 0;
  const selected: Allocation["selected"] = [];
  const skipped: Allocation["skipped"] = [];
  const seen = new Set<string>();
  const ranked = [...input.actions].sort((a,b) => weights[b.stage] - weights[a.stage] || a.dueAt - b.dueAt || b.evidenceAt - a.evidenceAt || a.id.localeCompare(b.id));
  for (const a of ranked) {
    let reason = "";
    if (!a.id || seen.has(a.id)) reason = "duplicate or missing action ID";
    else if (!integerCents(a.customerChargeCents) || a.customerChargeCents === 0 || !integerCents(a.estimatedProviderCostCents) || !Number.isFinite(a.evidenceAt) || !Number.isFinite(a.dueAt)) reason = "invalid estimate";
    else if (!a.permitted) reason = "not permitted";
    else if (a.dueAt > input.now) reason = "not due";
    else if (a.estimatedProviderCostCents > Math.floor(a.customerChargeCents * (1 - p.minimumGrossMarginFraction))) reason = "below margin floor";
    else if (selected.length >= p.maxQueuedActions) reason = "queue limit";
    else if (a.customerChargeCents > remaining) reason = "daily credit limit";
    else if (a.stage === "prospecting" && input.balanceCents - input.spentTodayCents - selected.reduce((sum,s) => sum + s.reservedCents,0) - a.customerChargeCents < protectedForActiveDealsCents) reason = "protected follow-up reserve";
    else if (a.stage === "prospecting" && prospectingUsed + a.customerChargeCents > prospectingBudget) reason = "prospecting share";
    if (reason) { skipped.push({ id: a.id, reason }); continue; }
    seen.add(a.id);
    selected.push({ id: a.id, stage: a.stage, reservedCents: a.customerChargeCents });
    remaining -= a.customerChargeCents;
    if (a.stage === "prospecting") prospectingUsed += a.customerChargeCents;
  }
  return { dailyLimitCents, remainingTodayCents: remaining, protectedForActiveDealsCents, selected, skipped };
}
