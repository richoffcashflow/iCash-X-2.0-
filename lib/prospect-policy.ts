/** Deterministic selection gates; provider-specific evidence is supplied by the server. */
export type Evidence = { value: number | null; confidence: number; updatedAt: number };
export type Prospect = {
  id: string;
  equityRatio: Evidence; // estimated, not a verified payoff
  repairSeverity: Evidence; // 0 to 1; photo/seller notes are estimates
  sellerIntent: Evidence; // explicit conversation outcome, 0 to 1
  buyerFit: Evidence; // historical and market data, 0 to 1
  requiredSignersIdentified: boolean;
  requiredSignersAligned: boolean;
  titleReviewed: boolean;
};
export type RankedProspect = { score: number; confidence: number; reasons: string[]; canPrepareOffer: boolean; blockers: string[] };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function rankProspect(p: Prospect, now: number): RankedProspect {
  if (!p.id || !Number.isFinite(now)) throw new Error("Invalid prospect");
  const signals: [string, Evidence, number][] = [
    ["Seller interest", p.sellerIntent, 0.35], ["Estimated equity", p.equityRatio, 0.25],
    ["Buyer fit", p.buyerFit, 0.25], ["Repair opportunity", p.repairSeverity, 0.15],
  ];
  let weighted = 0, present = 0, confidence = 0;
  const reasons: string[] = [];
  for (const [name, item, weight] of signals) {
    if (item.value === null) continue;
    if (![item.value, item.confidence, item.updatedAt].every(Number.isFinite)) throw new Error("Invalid evidence");
    const ageDays = Math.max(0, (now - item.updatedAt) / 86400000);
    const freshness = Math.max(0.2, 1 - ageDays / 180);
    const trust = clamp(item.confidence) * freshness;
    weighted += clamp(item.value) * weight * trust;
    confidence += weight * trust;
    present += weight;
    if (clamp(item.value) >= 0.6 && trust >= 0.4) reasons.push(name);
  }
  const blockers: string[] = [];
  if (!p.requiredSignersIdentified) blockers.push("required signers unknown");
  if (!p.requiredSignersAligned) blockers.push("required signers not aligned");
  if (!p.titleReviewed) blockers.push("title and vesting not reviewed");
  if (p.equityRatio.value === null || p.equityRatio.confidence < 0.7) blockers.push("equity/payoff needs verification");
  if (p.repairSeverity.value !== null && p.repairSeverity.confidence < 0.6) blockers.push("repair estimate needs review");
  return { score: Math.round(weighted * 100), confidence: Math.round((present ? confidence / present : 0) * 100), reasons, canPrepareOffer: blockers.length === 0, blockers };
}
export type WorkMode = "standard" | "always_analyzing";
export function allowedWork(mode: WorkMode, backgroundAuthorized: boolean, outreachPermittedNow: boolean, userPaused: boolean) {
  if (userPaused) return { research: false, outreach: false };
  return { research: backgroundAuthorized && mode === "always_analyzing", outreach: outreachPermittedNow };
}
