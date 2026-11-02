/** Read-only planning hints. SQL owns contact admission, source binding and authority. */
export type SellerProgressContext={
 priorActions?:string[];
 answered?:string[];
 reviewReason?:string|null;
 milestone?:string;
 customerNegotiation?:boolean;
};
export function planSellerProgress<T extends {action:string;facts:{kind:string;quote:string}[];humanRequested:boolean;callbackRequested:boolean;callRequested?:boolean;optedOut:boolean;declined:boolean}>(analysis:T,progress:SellerProgressContext|undefined){
 if(!progress||analysis.humanRequested||analysis.callbackRequested||analysis.callRequested||analysis.optedOut||analysis.declined)return analysis;
 if(progress.reviewReason||progress.customerNegotiation)return {...analysis,action:'review'};
 const asked=new Set(progress.priorActions??[]),answered=new Set([...(progress.answered??[]),...analysis.facts.map(f=>f.kind)]);
 // Completed or previously attempted questions cannot become another callback loop.
 const kind=analysis.action.replace(/^ask_/,'');
 if(asked.has(analysis.action)||answered.has(kind)||analysis.action==='ask_callback'){
  for(const fact of ['condition','price','timing','owners','occupancy']){
   if(!answered.has(fact)&&!asked.has('ask_'+fact))return {...analysis,action:'ask_'+fact};
  }
  return {...analysis,action:'review'};
 }
 return analysis;
}

export const sellerProgressInstructions=`
Progress toward a viable deal, using the server's sellerProgress history and the full conversation, including customer-authored messages. Callback questions are not a default next step. After a cooperative answer, collect one still-missing qualification fact; never repeat a prior action or answered question. Answer direct questions only through a supported action. A requested visit is visit coordination, not a phone callback. No third parties, price acceptance, human negotiation, contradictory prices, unsupported offers, completed qualification, contract requests and signature or title problems need the specific review milestone supplied by the server. Do not replace a customer's negotiation or treat a proposal, internal model estimate, seller acceptance or an offerAuthorized field in a property estimate as contractual authority. A signing envelope, dispatched message, confirmed appointment and completed title handoff each require their own verified result. Choose review when those checks are missing. Keep exact seller conditions and corrections intact. Customer drafts are not delivered messages. No tools or external actions are available.`;
