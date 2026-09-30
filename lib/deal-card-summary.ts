/** Only persisted production signatures and closing stages advance a deal card. */
export function dealCardSummary(
 deal:{id:string;stage:string;terms:{priceCents:number|null}}|undefined,
 envelopes:{deal_id:string;kind:string;state:string;test_mode:boolean}[]
){
 if(!deal)return null;
 const signed=(kind:string)=>envelopes.some(e=>e.deal_id===deal.id&&e.kind===kind&&e.state==='completed'&&!e.test_mode);
 const purchase=signed('purchase'),assignment=purchase&&signed('assignment');
 const closed=deal.stage==='closed',title=['title_open','closing','closed'].includes(deal.stage);
 return {priceCents:purchase&&Number.isSafeInteger(deal.terms.priceCents)&&deal.terms.priceCents!>=0?deal.terms.priceCents:null,
 steps:[{label:'Contract',done:purchase},{label:'Buyer',done:assignment},{label:'Title',done:title},{label:'Closed',done:closed}]};
}
