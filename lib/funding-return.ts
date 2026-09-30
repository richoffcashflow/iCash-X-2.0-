type Receipt={state:string;credit_cents:number;credited_at?:string|null;payer_email?:string|null};
/** Only summarize receipts already scoped to the current account or secure guest cookie. */
export function fundingReturnSummary(orders:Receipt[],signedIn:boolean){
 const paid=orders.filter(o=>o.state==='paid');
 return {
  paidCents:paid.reduce((total,o)=>total+o.credit_cents,0),
  needsClaim:paid.length>0&&(!signedIn||paid.some(o=>!o.credited_at)),
  email:paid[0]?.payer_email??null,
 };
}
