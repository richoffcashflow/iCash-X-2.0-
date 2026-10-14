/** Presentation only: readiness never grants offer, marketing or signing authority. */
export function showPropertyContract(deal:{id:string;stage:string;terms:{seller?:string;priceCents?:number|null;priceSource?:string}}|undefined,envelopes:{deal_id:string}[]){
 if(!deal)return false;
 if(envelopes.some(e=>e.deal_id===deal.id))return true;
 if(['under_contract','buyer_selected','assigned','buyer_matched','purchase_signed','assignment_signed','title_open','closing','closed','cancellation_pending','canceled','cancelled'].includes(deal.stage))return true;
 return deal.terms.priceSource==='seller_reported'&&!!deal.terms.seller?.trim()&&Number.isSafeInteger(deal.terms.priceCents)&&deal.terms.priceCents!>0;
}

/** Show later tools only after signing or when saved activity needs them. */
export function dealToolVisibility(deal:{id:string;stage:string}|undefined,envelopes:{deal_id:string;kind:string;state:string;test_mode:boolean}[],nextSection:string|null=null,hasBuyerActivity=false){
 if(!deal)return {buyers:false,coordination:false,buyerReview:false};
 const purchaseSigned=envelopes.some(e=>e.deal_id===deal.id&&e.kind==='purchase'&&e.state==='completed'&&!e.test_mode);
 const savedProgress=['under_contract','buyer_selected','assigned','buyer_matched','purchase_signed','assignment_signed','title_open','closing','closed'].includes(deal.stage);
 const stopped=['cancellation_pending','canceled','cancelled'].includes(deal.stage);
 return {
  buyers:['fulfillment','closing'].includes(nextSection??'')||(!stopped&&(purchaseSigned||savedProgress||hasBuyerActivity)),
  coordination:nextSection==='coordination'||(!stopped&&(purchaseSigned||savedProgress||hasBuyerActivity)),
  buyerReview:purchaseSigned&&!stopped
 };
}
