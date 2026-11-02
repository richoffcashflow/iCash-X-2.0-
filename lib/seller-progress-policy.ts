/** Read-only planning hints. SQL owns contact admission, source binding and authority. */
export type SellerProgressContext={
 priorActions?:string[];
 answered?:string[];
 reviewReason?:string|null;
 milestone?:string;
 customerNegotiation?:boolean;
 dialogue?:{sourceBody?:string;routineQualification?:boolean;action?:string|null;conditionState?:string|null};
};
export function planSellerProgress<T extends {action:string;facts:{kind:string;quote:string}[];humanRequested:boolean;callbackRequested:boolean;callRequested?:boolean;optedOut:boolean;declined:boolean}>(analysis:T,progress:SellerProgressContext|undefined){
 if(!progress||analysis.humanRequested||analysis.callbackRequested||analysis.callRequested||analysis.optedOut||analysis.declined)return analysis;
 if(progress.reviewReason||progress.customerNegotiation)return {...analysis,action:'review'};
 const asked=new Set(progress.priorActions??[]),answered=new Set([...(progress.answered??[]),...analysis.facts.map(f=>f.kind)]);
 // Completed or previously attempted questions cannot become another callback loop.
 const kind=analysis.action.replace(/^ask_/,'');
 const ordinaryAnswer=analysis.action==='review'&&progress.dialogue?.routineQualification===true&&analysis.facts.some(f=>f.quote===progress.dialogue?.sourceBody);
 if(asked.has(analysis.action)||answered.has(kind)||analysis.action==='ask_callback'||ordinaryAnswer){
  for(const fact of ['condition','price','timing','owners','occupancy']){
   if(!answered.has(fact)&&!asked.has('ask_'+fact))return {...analysis,action:'ask_'+fact};
  }
  return {...analysis,action:'review'};
 }
 return analysis;
}

export const sellerProgressInstructions=`
Progress toward a viable deal, using the server's sellerProgress history and the full conversation, including customer-authored messages. Handle ordinary seller questions and qualification automatically; do not choose review just because the seller asks a question or states a concern. Callback questions are not a default next step. After a cooperative answer, collect one still-missing qualification fact; never repeat a prior action or answered question. Answer direct questions only through a supported action. For "no third parties," first clarify whether the seller means agents or assignment to another buyer. The server's dialogue workflow asks that question, explains assignment honestly, and binds the answer to the delivered question. Do not assume direct-buy capacity or treat willingness to consider assignment as ownership, contact consent or a signed agreement. Once the condition is clarified, use that answer and continue; do not keep escalating the original phrase. A requested visit means collect viewing availability and access details, not ask for a phone callback or claim a booking. Routine price/process/fee questions and photo acknowledgments have fixed informational replies; financial terms remain uncommitted. Price acceptance, human negotiation, contradictory prices, unsupported offers, completed qualification, contract requests and signature or title problems retain their specific authority checks. Do not replace a customer's negotiation or treat a proposal, internal model estimate, seller acceptance or an offerAuthorized field in a property estimate as contractual authority. A signing envelope, dispatched message, confirmed appointment and completed title handoff each require their own verified result. Review is for a concrete unresolved decision, explicit human request, unsafe ambiguity after clarification, or a real admission failure. Keep exact seller conditions and corrections intact. Customer drafts are not delivered messages. No tools or external actions are available.`;
