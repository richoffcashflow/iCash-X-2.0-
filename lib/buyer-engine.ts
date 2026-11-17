/** Pure planning only. Discovery, consent evidence and costs come from verified provider/server records. */
export type Buyer = { id: string; entityId: string; markets: string[]; propertyTypes: string[]; maxPriceCents: number; maxRepairCents: number; criteriaConfirmedAt: number; permitted: boolean; proofOfFundsVerifiedAt: number | null; authorityVerified: boolean; completedDeals: number | null; failedDeals: number | null; estimatedContactChargeCents: number };
export type BuyerDeal = { market: string; propertyType: string; askingPriceCents: number; repairsCents: number; sellerContractSigned: boolean; marketingAuthorized: boolean };
const money = (n:number)=>Number.isSafeInteger(n)&&n>=0;
export function planBuyerOutreach(deal: BuyerDeal, buyers: Buyer[], now: number, availableCents: number, reserveCents: number) {
  if (![deal.askingPriceCents,deal.repairsCents,availableCents,reserveCents].every(money) || !Number.isFinite(now)) throw new Error("Invalid buyer plan");
  // Research may precede contract; sending a deal package may not.
  const canSendDeal = deal.sellerContractSigned && deal.marketingAuthorized;
  const fresh = (at:number|null)=>at!==null && Number.isFinite(at) && at<=now && now-at<=30*86400000;
  const candidates = buyers.filter(b=>b.id && b.entityId && [b.maxPriceCents,b.maxRepairCents,b.estimatedContactChargeCents].every(money) && [b.completedDeals,b.failedDeals].every(n=>n===null||money(n)) && b.estimatedContactChargeCents>0 && b.markets.includes(deal.market) && b.propertyTypes.includes(deal.propertyType) && b.maxPriceCents>=deal.askingPriceCents && b.maxRepairCents>=deal.repairsCents && fresh(b.criteriaConfirmedAt)).map(b=>({
    ...b, ready: fresh(b.proofOfFundsVerifiedAt)&&b.authorityVerified,
    score: (b.completedDeals===null||b.failedDeals===null?30:Math.round(60*((b.completedDeals+1)/(b.completedDeals+b.failedDeals+2))))+(fresh(b.proofOfFundsVerifiedAt)?25:0)+(b.authorityVerified?15:0),
  }));
  // Prefer verified readiness, then closing history. Among equally qualified
  // buyers, current price/repair headroom beats an arbitrary database ID.
  const fit=(b:typeof candidates[number])=>Math.min(1,(b.maxPriceCents-deal.askingPriceCents)/Math.max(1,deal.askingPriceCents))
   +Math.min(1,(b.maxRepairCents-deal.repairsCents)/Math.max(1,deal.repairsCents));
  const byScore=(a:typeof candidates[number],b:typeof candidates[number])=>Number(b.ready)-Number(a.ready)||b.score-a.score||fit(b)-fit(a)||a.id.localeCompare(b.id);
  const entities=new Map<string,typeof candidates>();
  for(const b of candidates.sort(byScore)){const contacts=entities.get(b.entityId)??[];contacts.push(b);entities.set(b.entityId,contacts);}
  // Deduplicate after checking each contact's own permission and cost. A higher
  // score must not hide a usable contact at the same entity or transfer consent.
  const representatives=[...entities.values()].map(contacts=>contacts.find(b=>b.permitted)??contacts[0]).sort(byScore);
  let remaining = Math.max(0,availableCents-reserveCents);
  const outreach: string[] = [];
  const ranked=representatives.map(representative=>{
    const contact=canSendDeal&&outreach.length<5?entities.get(representative.entityId)!.find(b=>b.permitted&&b.estimatedContactChargeCents<=remaining):undefined;
    if(contact){outreach.push(contact.id);remaining-=contact.estimatedContactChargeCents;}
    return contact??representative;
  }).sort(byScore);
  const primary=outreach[0]??ranked.find(b=>b.ready&&b.permitted)?.id;
  return { matches:ranked.map(b=>({id:b.id,score:b.score,ready:b.ready})),outreach,
    backupBuyerIds:ranked.filter(b=>b.id!==primary&&b.ready&&b.permitted).map(b=>b.id),
    qualificationNeededIds:ranked.filter(b=>!b.ready).map(b=>b.id),
    reservedContactCents:Math.max(0,availableCents-reserveCents)-remaining,canSendDeal };
}
