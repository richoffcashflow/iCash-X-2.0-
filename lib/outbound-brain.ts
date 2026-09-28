import {fullCostReserve,type CostQuote} from './cost-guard.ts';
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
  costQuote?: CostQuote;
  evidenceAt: number; // UTC timestamp from a real event
  dueAt: number;
  operation?: 'seller_call' | 'other';
  financialCheck?: {status:'eligible'|'hold';checkedAt:number;reason:string}; // server-authored, persisted underwriting result
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
  companyAvailableBudgetCents?: number;
  companyProtectedReserveCents?: number;
};
export type Allocation = {
  dailyLimitCents: number;
  remainingTodayCents: number;
  protectedForActiveDealsCents: number;
  selected: { id: string; stage: WorkStage; reservedCents: number; reservedCostCents:number; rateVersion:string }[];
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
  const companyBudget=input.companyAvailableBudgetCents,companyReserve=input.companyProtectedReserveCents;
  const companyConfigured=companyBudget!==undefined&&companyReserve!==undefined&&integerCents(companyBudget)&&integerCents(companyReserve);
  let companyRemaining=companyConfigured?Math.max(0,companyBudget!-companyReserve!):0;
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
    const cost=fullCostReserve(a.costQuote,input.now);
    if (!a.id || seen.has(a.id)) reason = "duplicate or missing action ID";
    else if (!integerCents(a.customerChargeCents) || a.customerChargeCents === 0 || !integerCents(a.estimatedProviderCostCents) || !Number.isFinite(a.evidenceAt) || !Number.isFinite(a.dueAt)) reason = "invalid estimate";
    else if (a.operation === 'seller_call' && (!a.financialCheck || a.financialCheck.status !== 'eligible' || !Number.isFinite(a.financialCheck.checkedAt) || a.financialCheck.checkedAt > input.now || input.now - a.financialCheck.checkedAt > 86400000)) reason = "financial screening required before seller call";
    else if (!a.permitted) reason = "not permitted";
    else if (a.dueAt > input.now) reason = "not due";
    else if (!companyConfigured) reason = "company budget not configured";
    else if (!cost.ok) reason = cost.reason;
    else if (cost.reserveCents < a.estimatedProviderCostCents) reason = "full cost quote understates provider cost";
    else if (cost.reserveCents > Math.floor(a.customerChargeCents * (1 - p.minimumGrossMarginFraction))) reason = "below margin floor";
    else if (cost.reserveCents > companyRemaining) reason = "company cost budget exhausted";
    else if (selected.length >= p.maxQueuedActions) reason = "queue limit";
    else if (a.customerChargeCents > remaining) reason = "daily credit limit";
    else if (a.stage === "prospecting" && input.balanceCents - selected.reduce((sum,s) => sum + s.reservedCents,0) - a.customerChargeCents < protectedForActiveDealsCents) reason = "protected follow-up reserve";
    else if (a.stage === "prospecting" && prospectingUsed + a.customerChargeCents > prospectingBudget) reason = "prospecting share";
    if (reason) { skipped.push({ id: a.id, reason }); continue; }
    if(!cost.ok) continue;
    seen.add(a.id);
    selected.push({ id: a.id, stage: a.stage, reservedCents: a.customerChargeCents, reservedCostCents:cost.reserveCents,rateVersion:cost.rateVersion });
    companyRemaining-=cost.reserveCents;
    remaining -= a.customerChargeCents;
    if (a.stage === "prospecting") prospectingUsed += a.customerChargeCents;
  }
  return { dailyLimitCents, remainingTodayCents: remaining, protectedForActiveDealsCents, selected, skipped };
}
