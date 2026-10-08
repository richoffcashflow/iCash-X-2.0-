import {object} from './required-call-recording.ts';
import {spokenMoneyAmounts} from './call-offer-evidence.ts';

/** Seller statements support a proposed contract, never verified title or proceeds. */
export type SellerPayoffReport={mortgageCents?:number;otherDebtCents?:number;coveredShortfallCents?:number;coverageDeclined?:boolean};
export type SellerPayoffUpdate=Partial<SellerPayoffReport>;
const validCents=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=100000000000;
export function sellerPayoffPosition(report:SellerPayoffReport|undefined,priceCents:number){
 if(!report||!validCents(report.mortgageCents))return null;
 if(!validCents(report.otherDebtCents))return {complete:false as const,mortgageCents:report.mortgageCents};
 const totalDebtCents=report.mortgageCents+report.otherDebtCents;
 if(!validCents(totalDebtCents))return null;
 const shortfallCents=Math.max(0,totalDebtCents-priceCents);
 return {complete:true as const,mortgageCents:report.mortgageCents,otherDebtCents:report.otherDebtCents,totalDebtCents,shortfallCents,
  canProceed:shortfallCents===0||!report.coverageDeclined&&validCents(report.coveredShortfallCents)&&report.coveredShortfallCents>=shortfallCents};
}

/** Extract only the latest exact caller statement, bound to the preceding
 * question. Tool arguments cannot manufacture a payoff or a promise to pay. */
export function sellerPayoffEvidence(value:unknown,input:Record<string,unknown>):SellerPayoffUpdate|null{
 if(input.action!=='report_change'||typeof input.sellerStatement!=='string')return null;
 const rows=object(value).transcript;if(!Array.isArray(rows))return null;
 const turns=rows.map(object).filter(t=>['user','agent'].includes(String(t.role))&&typeof t.message==='string');
 const index=turns.findLastIndex(t=>t.role==='user');
 const latest=String(turns[index]?.message??'').trim(),previous=String(turns.slice(0,index).findLast(t=>t.role==='agent')?.message??'');
 const actual=extractPayoff(latest,previous),requested=extractPayoff(input.sellerStatement,previous);
 return actual&&requested&&JSON.stringify(actual)===JSON.stringify(requested)?actual:null;
}
function extractPayoff(latest:string,previous:string):SellerPayoffUpdate|null{
 if(/\b(another owner|other owner|not the owner|ownership|deed|inherited|divorce|wrong (?:property|address)|new (?:roof|foundation)|fire damage)\b/i.test(latest))return null;
 const amounts=spokenMoneyAmounts(latest);
 const uncertain=/\b(between|not sure|don['’]?t know|no idea|more than|less than|at least|at most|under|over|or maybe)\b/i.test(latest);
 const coverageQuestion=/\b(cover|bring|pay)\b/i.test(previous)&&/\b(difference|shortfall|out of pocket|closing)\b/i.test(previous);
 if(coverageQuestion){
  const asked=spokenMoneyAmounts(previous);
  if(asked.length!==1||asked[0]<=0)return null;
  if(/^(?:no|nope)\b|\b(can['’]?t|cannot|won['’]?t|unable)\b/i.test(latest))return {coveredShortfallCents:0,coverageDeclined:true};
  if(!uncertain&&!/\b(not|but|unless|if|maybe)\b/i.test(latest)&&/^(?:yes|yeah|yep|correct|i can|i will|i['’]?ll|that works)\b/i.test(latest)&&(!amounts.length||amounts.length===1&&amounts[0]===asked[0]))return {coveredShortfallCents:asked[0],coverageDeclined:false};
  return null;
 }
 const otherQuestion=/\b(other|additional|besides|apart from)\b/i.test(previous)&&/\b(debt|debts|lien|liens|taxes|hoa|mortgage|loan)\b/i.test(previous);
 const onlyDebt=/\b(?:that(?:['’]s| is)|it(?:['’]s| is)) (?:the )?only (?:debt|mortgage|loan)\b|\bno (?:other|additional) (?:debts?|liens?|loans?|mortgages?|taxes)\b/i.test(latest);
 if(onlyDebt&&!uncertain&&!amounts.length&&!/\b(not the only|isn['’]?t the only|except|but (?:there|I (?:also|owe)))\b/i.test(latest))return {otherDebtCents:0};
 if(otherQuestion){
  if(/^(?:no|nope|none)(?:[,.!]|$|\s+(?:that|there|nothing))/i.test(latest)&&!amounts.length)return {otherDebtCents:0};
  if(!uncertain&&amounts.length===1&&!/\b(not|repairs?|asking|offer)\b/i.test(latest)&&!(/\b(mortgage|payoff)\b/i.test(latest)&&! /\b(other|additional|second)\b/i.test(latest)))return {otherDebtCents:amounts[0]};
  return null;
 }
 const mortgageQuestion=/\b(mortgage|payoff|loan|heloc|owe)\b/i.test(previous);
 const mortgageStatement=/\b(mortgage|payoff|loan|heloc|owe|owed)\b/i.test(latest);
 if(!mortgageQuestion&&!mortgageStatement)return null;
 if(/\b(paid off|free and clear|no mortgages?|no loans?)\b/i.test(latest)&&! /\b(not|but|except|still)\b/i.test(latest)&&!amounts.some(n=>n>0))return {mortgageCents:0};
 if(uncertain||amounts.length!==1||/\b(not|instead|repairs?|asking|offer)\b/i.test(latest))return null;
 return {mortgageCents:amounts[0],...(onlyDebt?{otherDebtCents:0}:{})};
}
