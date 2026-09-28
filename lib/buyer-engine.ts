/** Pure planning only. Discovery, consent evidence and costs come from verified provider/server records. */
export type Buyer = { id: string; entityId: string; markets: string[]; propertyTypes: string[]; maxPriceCents: number; maxRepairCents: number; criteriaConfirmedAt: number; permitted: boolean; proofOfFundsVerifiedAt: number | null; authorityVerified: boolean; completedDeals: number; failedDeals: number; estimatedContactChargeCents: number };
export type BuyerDeal = { market: string; propertyType: string; askingPriceCents: number; repairsCents: number; sellerContractSigned: boolean; marketingAuthorized: boolean };
const money = (n:number)=>Number.isSafeInteger(n)&&n>=0;
export function planBuyerOutreach(deal: BuyerDeal, buyers: Buyer[], now: number, availableCents: number, reserveCents: number) {
  if (![deal.askingPriceCents,deal.repairsCents,availableCents,reserveCents].every(money) || !Number.isFinite(now)) throw new Error("Invalid buyer plan");
  // Research may precede contract; sending a deal package may not.
  const canSendDeal = deal.sellerContractSigned && deal.marketingAuthorized;
  const fresh = (at:number|null)=>at!==null && Number.isFinite(at) && at<=now && now-at<=30*86400000;
  const seen = new Set<string>();
  const ranked = buyers.filter(b=>b.id && b.entityId && [b.maxPriceCents,b.maxRepairCents,b.completedDeals,b.failedDeals,b.estimatedContactChargeCents].every(money) && b.estimatedContactChargeCents>0 && b.markets.includes(deal.market) && b.propertyTypes.includes(deal.propertyType) && b.maxPriceCents>=deal.askingPriceCents && b.maxRepairCents>=deal.repairsCents && fresh(b.criteriaConfirmedAt)).map(b=>({
    ...b, ready: fresh(b.proofOfFundsVerifiedAt)&&b.authorityVerified,
    score: Math.round(60*((b.completedDeals+1)/(b.completedDeals+b.failedDeals+2)))+(fresh(b.proofOfFundsVerifiedAt)?25:0)+(b.authorityVerified?15:0),
  })).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).filter(b=>{if(seen.has(b.entityId))return false;seen.add(b.entityId);return true;});
  let remaining = Math.max(0,availableCents-reserveCents);
  const outreach: string[] = [];
  for(const b of ranked) if(canSendDeal && b.permitted && b.estimatedContactChargeCents<=remaining && outreach.length<5){outreach.push(b.id);remaining-=b.estimatedContactChargeCents;}
  return { matches:ranked.map(b=>({id:b.id,score:b.score,ready:b.ready})),outreach,backupBuyerIds:ranked.slice(1).map(b=>b.id),reservedContactCents:Math.max(0,availableCents-reserveCents)-remaining,canSendDeal };
}
