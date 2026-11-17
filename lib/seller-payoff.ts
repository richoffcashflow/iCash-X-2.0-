import {sellerQuestion} from './seller-question-evidence.ts';
import {object} from './required-call-recording.ts';
import {callOfferEvidence,spokenMoneyAmounts} from './call-offer-evidence.ts';
import {sellerContactPurposeQuestion} from './seller-contact-purpose.ts';

/** Seller statements support a proposed contract, never verified title or proceeds. */
export type SellerPayoffReport={mortgageCents?:number;otherDebtCents?:number;coveredShortfallCents?:number;coverageDeclined?:boolean};
export type SellerPayoffUpdate=Partial<SellerPayoffReport>;
export type SellerPayoffRecovery={report:SellerPayoffReport;acceptedAfterReport:boolean};
const validCents=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=100000000000;
const completeNegative=(text:string)=>/^(?:(?:um|uh|well)[,.\s]+)*(?:no|nope|none)(?:[,. ]+(?:no|none|not any|there (?:are not|aren't|is not|isn't) any|nothing else))*[.! ]*$/i.test(text.replace(/[’]/g,"'"));
export function sellerPayoffPosition(report:SellerPayoffReport|undefined,priceCents:number){
 if(!report||!validCents(report.mortgageCents))return null;
 if(!validCents(report.otherDebtCents))return {complete:false as const,mortgageCents:report.mortgageCents};
 const totalDebtCents=report.mortgageCents+report.otherDebtCents;
 if(!validCents(totalDebtCents))return null;
 const shortfallCents=Math.max(0,totalDebtCents-priceCents);
 return {complete:true as const,mortgageCents:report.mortgageCents,otherDebtCents:report.otherDebtCents,totalDebtCents,shortfallCents,
  canProceed:shortfallCents===0||!report.coverageDeclined&&validCents(report.coveredShortfallCents)&&report.coveredShortfallCents>=shortfallCents};
}

/** Recover only a missed zero-other-debt answer beside the already saved
 * mortgage. The final actual question supplies its meaning; later uncertain or
 * changed debt answers invalidate recovery. This does not verify title. */
export function sellerPayoffRecovery(value:unknown,mortgageCents:number,priceCents:number):SellerPayoffRecovery|null{
 if(!validCents(mortgageCents)||!validCents(priceCents)||priceCents<1)return null;
 const rows=object(value).transcript;if(!Array.isArray(rows)||rows.length>500)return null;
 const turns=rows.map(object).filter(t=>['user','agent'].includes(String(t.role))&&typeof t.message==='string');
 const lastQuestion=sellerQuestion;
 const debt=/\b(?:mortgages?|payoff|loans?|heloc|debts?|liens?|tax(?:es)?|hoa|owe|owed|judgments?|balances?|financial obligations?)\b/i;
 let candidate=-1;
 for(let n=0;n<turns.length;n++){
  if(turns[n].role!=='user')continue;
  const text=String(turns[n].message).trim(),question=lastQuestion(String(turns.slice(0,n).findLast(t=>t.role==='agent')?.message??''));
  // A later debt correction/unknown cannot be ignored because the model also
  // skipped its report_change. A price question mentioning a conditional
  // payoff in an earlier sentence is not itself a debt question.
  const offerQuestion=/\b(?:does|will|would) (?:that|this|the) (?:cash )?(?:offer|price) (?:work|fit)\b.*\?$/i.test(question);
  if(debt.test(text)||debt.test(question)&&!offerQuestion||/\b(?:not sure|do not know|don['’]?t know|maybe|might|could be|possibly)\b/i.test(text))candidate=-1;
  const inventory=/^(?:are there|do you have) (?:any )?(?:other|additional) (.+?)(?: besides (?:that|the|your) mortgage)?\?$/i.exec(question)?.[1]??'';
  if(!['loan','lien','tax','hoa'].every(word=>new RegExp('\\b'+word,'i').test(inventory))||inventory.replace(/\b(?:loans?|liens?|(?:unpaid )?taxes|hoa (?:debts?|balances?)|and|or)\b|[ ,]/gi,'')!=='')continue;
  if(!completeNegative(text))continue;
  const answer=extractPayoff(text,question);if(answer?.otherDebtCents!==0)continue;
  const prior=turns.slice(0,n).findLastIndex(t=>t.role==='user');if(prior<0)continue;
  const priorQuestion=lastQuestion(String(turns.slice(0,prior).findLast(t=>t.role==='agent')?.message??''));
  if(!priorQuestion.endsWith('?')||!/\b(?:mortgage|payoff|loan|owe)\b/i.test(priorQuestion)||/\b(?:other|additional|besides|apart from|repairs?|price|offer)\b/i.test(priorQuestion))continue;
  const mortgage=extractPayoff(String(turns[prior].message),priorQuestion);
  if(mortgage?.mortgageCents!==mortgageCents)continue;
  candidate=n;
 }
 if(candidate<0)return null;
 return {report:{mortgageCents,otherDebtCents:0},acceptedAfterReport:callOfferEvidence({transcript:turns.slice(candidate+1)},{action:'accept_offer',priceCents})};
}

/** Extract the latest caller answer, bound to its real question, with a missed
 * mortgage answer from the adjacent debt exchange. Arguments cannot invent facts. */
export function sellerPayoffEvidence(value:unknown,input:Record<string,unknown>):SellerPayoffUpdate|null{
 if(input.action!=='report_change'||typeof input.sellerStatement!=='string')return null;
 const rows=object(value).transcript;if(!Array.isArray(rows))return null;
 const turns=rows.map(object).filter(t=>['user','agent'].includes(String(t.role))&&typeof t.message==='string');
 const index=turns.findLastIndex(t=>t.role==='user');
 const questionIndex=turns.slice(0,index).findLastIndex(t=>t.role==='agent');
 if(turns.slice(questionIndex+1,index).some(t=>t.role==='user'&&sellerContactPurposeQuestion(String(t.message))))return null;
 const latest=String(turns[index]?.message??'').trim(),previous=String(turns.slice(0,index).findLast(t=>t.role==='agent')?.message??'');
 const actual=extractPayoff(latest,previous),requested=extractPayoff(input.sellerStatement,previous);
 if(!actual||!requested||JSON.stringify(actual)!==JSON.stringify(requested))return null;
 // A provider interruption can skip saving the mortgage answer. Recover it
 // only from the immediately preceding seller turn when this turn answers the
 // follow-up about other debts. Both answers stay bound to their real questions;
 // never scan past a correction, unknown answer or another seller statement.
 const otherDebtQuestion=/\b(other|additional|besides|apart from)\b/i.test(previous)&&/\b(debt|debts|lien|liens|taxes|hoa|mortgage|loan)\b/i.test(previous);
 if(actual.otherDebtCents!==undefined&&otherDebtQuestion){
  const priorIndex=turns.slice(0,index).findLastIndex(t=>t.role==='user');
  if(priorIndex<0)return actual;
  const priorAnswer=String(turns[priorIndex]?.message??'').trim();
  const priorQuestion=String(turns.slice(0,priorIndex).findLast(t=>t.role==='agent')?.message??'');
  const prior=extractPayoff(priorAnswer,priorQuestion);
  if(prior?.mortgageCents!==undefined)return {mortgageCents:prior.mortgageCents,...actual};
 }
 return actual;
}
function extractPayoff(latest:string,previous:string):SellerPayoffUpdate|null{
 const originalQuestion=previous;previous=sellerQuestion(previous);
 if(sellerContactPurposeQuestion(latest))return null;
 if(/\b(another owner|other owner|not the owner|ownership|deed|inherited|divorce|wrong (?:property|address)|new (?:roof|foundation)|fire damage)\b/i.test(latest))return null;
 // A single unqualified "no" can answer the complete debt inventory. Keep it
 // tied to that exact final question: a mortgage-only or additional-debt
 // question cannot establish both balances, and a mixed/corrected answer
 // cannot erase an unknown debt. These remain seller reports, not title proof.
 const question=previous;
 const inventory=/^(?:is there|are there|do you have|does (?:the|this|your) (?:property|house|home) have) (?:any )?(.+?)(?: on (?:the|this|your) (?:property|house|home))?(?: that (?:need|needs) to be paid(?: off)?(?: at closing)?)?\?$/i.exec(question)?.[1]??'';
 const wholeDebtQuestion=/\b(?:mortgages?|loans?)\b/i.test(inventory)&&/\bliens?\b/i.test(inventory)&&/\btaxes\b/i.test(inventory)&&/\bhoa (?:debts?|balances?)\b/i.test(inventory)
  &&inventory.replace(/\b(?:mortgages?|loans?|liens?|(?:unpaid )?taxes|hoa (?:debts?|balances?)|and|or)\b|[ ,]/gi,'')==='';
 const completeNo=completeNegative(latest);
 if(wholeDebtQuestion&&completeNo)return {mortgageCents:0,otherDebtCents:0};
 const amounts=spokenMoneyAmounts(latest);
 const uncertain=/\b(between|not sure|don['’]?t know|no idea|more than|less than|at least|at most|under|over|maybe|might|could|think|possibly|probably)\b/i.test(latest);
 const coverageQuestion=/\b(cover|bring|pay)\b/i.test(previous)&&/\b(difference|shortfall|out of pocket|closing)\b/i.test(previous);
 if(coverageQuestion){
  const asked=spokenMoneyAmounts(originalQuestion);
  if(asked.length!==1||asked[0]<=0)return null;
  if(/^(?:no|nope)\b|\b(can['’]?t|cannot|won['’]?t|unable)\b/i.test(latest))return {coveredShortfallCents:0,coverageDeclined:true};
  if(!uncertain&&!/\b(not|but|unless|if|maybe)\b/i.test(latest)&&/^(?:yes|yeah|yep|correct|i can|i will|i['’]?ll|that works)\b/i.test(latest)&&(!amounts.length||amounts.length===1&&amounts[0]===asked[0]))return {coveredShortfallCents:asked[0],coverageDeclined:false};
  return null;
 }
 const otherQuestion=/\b(other|additional|besides|apart from)\b/i.test(previous)&&/\b(debt|debts|lien|liens|taxes|hoa|mortgage|loan)\b/i.test(previous);
 const onlyDebt=/\b(?:that(?:['’]s| is)|it(?:['’]s| is)) (?:the )?only (?:debt|mortgage|loan)\b|\bno (?:other|additional) (?:debts?|liens?|loans?|mortgages?|taxes)\b/i.test(latest);
 // A leading "no" may reject the premise before disclosing a different debt.
 // Unknown lien/tax amounts must stay unknown, including after earlier zeros.
 const additionalDebt=/\b(?:unpaid|outstanding|still owe)\b|\b(?:there (?:is|are)|i (?:also )?(?:have|owe))\s+(?:(?:a|an|some|another|back|additional|other)\s+)*(?:debts?|liens?|loans?|taxes|mortgages?|hoa|balances?)\b|\b(?:but|except|however|although)\b[^.!?]{0,100}\b(?:debts?|liens?|loans?|taxes|mortgages?|hoa|balances?)\b/i.test(latest);
 if(onlyDebt&&!uncertain&&!amounts.length&&!additionalDebt&&!/\b(not the only|isn['’]?t the only)\b/i.test(latest))return {otherDebtCents:0};
 if(otherQuestion){
  if(completeNo&&!amounts.length&&!additionalDebt&&!uncertain)return {otherDebtCents:0};
  if(!uncertain&&amounts.length===1&&!/\b(not|repairs?|asking|offer)\b/i.test(latest)&&!(/\b(mortgage|payoff)\b/i.test(latest)&&! /\b(other|additional|second)\b/i.test(latest)))return {otherDebtCents:amounts[0]};
  return null;
 }
 const mortgageQuestion=/\b(mortgage|payoff|loan|heloc|owe)\b/i.test(previous);
 const mortgageStatement=/\b(mortgage|payoff|loan|heloc|owe|owed)\b/i.test(latest);
 if(!mortgageQuestion&&!mortgageStatement)return null;
 if(/^(?:i )?(?:do not|don['’]?t) owe anything[.! ]*$/i.test(latest)&&mortgageQuestion)return {mortgageCents:0};
 if(/\b(paid off|free and clear|no mortgages?|no loans?)\b/i.test(latest)&&! /\b(not|but|except|still)\b/i.test(latest)&&!amounts.some(n=>n>0))return {mortgageCents:0};
 if(uncertain||amounts.length!==1||/\b(not|instead|repairs?|asking|offer)\b/i.test(latest))return null;
 return {mortgageCents:amounts[0],...(onlyDebt?{otherDebtCents:0}:{})};
}
