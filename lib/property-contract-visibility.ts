/** Presentation only: readiness never grants offer, marketing or signing authority. */
export function showPropertyContract(deal:{id:string;stage:string;terms:{seller?:string;priceCents?:number|null;priceSource?:string}}|undefined,envelopes:{deal_id:string}[]){
 if(!deal)return false;
 if(envelopes.some(e=>e.deal_id===deal.id))return true;
 if(['under_contract','title_open','closing','closed'].includes(deal.stage))return true;
 return deal.terms.priceSource==='seller_reported'&&!!deal.terms.seller?.trim()&&Number.isSafeInteger(deal.terms.priceCents)&&deal.terms.priceCents!>0;
}
