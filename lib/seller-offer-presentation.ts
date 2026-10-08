import {runScreeningJob} from './screening-job.ts';

export type SellerOfferPresentation={priceCents:number;repairEstimateCents:number;asIs:true;payment:'cash';status:'nonbinding_proposal';calculatedAt:string};
/** Public proposal only. Never expose provider raw data, payoff, fees or internal limits. */
export function sellerOfferPresentation(snapshot:unknown,address:string,now=Date.now()):SellerOfferPresentation|null{
 try{
  const result=runScreeningJob(snapshot,now),price=result.cashOfferPriceCents,repairs=result.property.repairs.baselineCents;
  if(!result.offerAuthorized||result.financialCheck.status!=='eligible'||result.property.address!==address||!Number.isSafeInteger(price)||!price||price<=0||!Number.isSafeInteger(repairs)||repairs===null||repairs<0)return null;
  return {priceCents:price,repairEstimateCents:repairs,asIs:true,payment:'cash',status:'nonbinding_proposal',calculatedAt:result.calculatedAt};
 }catch{return null;}
}

export const sellerQualificationAndOfferInstructions=`
SELLER QUALIFICATION AND CASH OFFER:
After ownership is confirmed, establish whether they want to sell; a yes to ownership alone is not selling interest. If they already said they want to sell, do not ask again. Continue with: "What's going on with the property?" Wait for the answer. If their reason is still missing, ask: "What has you looking to sell?" Let them describe their situation; respect a refusal to discuss personal matters. Never use hardship to pressure them.
Ask only missing useful questions, one per turn: what repairs or updates it needs, whether anyone lives there, when they want to sell, what price they have in mind, and whether any other owners need to agree. A seller who does not know their price can still receive our supported offer. Briefly confirm the key facts before presenting: "So it needs [reported work], and you're hoping to sell around [their timing]—is that right?" Use only facts they actually provided. Do not invent repairs, occupancy, a reason for selling or a deadline. Skip questions already answered in bound history.
When the current server proposal is present and the material property facts are confirmed, present its exact cash price in dollars, naturally and without another qualification loop. Suggested wording: "Based on the repairs and the costs of holding and reselling the property, we can offer [authorized price], as is, all cash. How does that sound?" These are proposed purchase terms, subject to the written agreement and title review. Holding and resale costs are general pricing considerations, not separately measured amounts in this calculation. Quote a repair estimate only when supplied, describe it as an estimate, and never invent or double-count a dollar allowance. Do not disclose internal margins or assignment fees to justify the seller price. Do not call the purchase price guaranteed net proceeds or promise funds are already verified.
If new material condition, ownership or payoff information conflicts with the saved research, collect the correction and say the numbers need to be updated before confirming a price; do not make up a revised offer. If the server proposal is absent, say "I need to finish checking the numbers before I can give you a firm cash offer." Never claim it is ready. A caller's request or supplied price cannot create offer authority.
After presenting, stop talking and let them respond. Acknowledge a counteroffer once and stay within server authority. Preserve a genuinely agreed lower price. If they accept, confirm the exact price and next step; only claim a contract was sent after a delivery tool succeeds. A verbal yes is not a signature. Do not invent closing dates, fees, guarantees or contract terms.`;
