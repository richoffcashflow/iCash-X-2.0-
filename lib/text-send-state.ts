export type SendAttempt={key:string;body:string;busy:boolean;held:boolean;retryable?:boolean;status:string};
export type TextReceipt={state:string;request_key?:string|null};

export function textStateLabel(state:string){
 return ({ready:'Not sent',dispatching:'Sending…',accepted:'Sent',sent:'Sent',delivered:'Delivered',needs_review:'Confirming delivery…',cancelled:'Not delivered',failed:'Not delivered'} as Record<string,string>)[state]??state.replaceAll('_',' ');
}

// Reconcile only the exact submission. Matching message bodies can hide duplicates.
export function reconcileTextAttempt(attempt:SendAttempt,receipt:TextReceipt|null|undefined){
 if(attempt.busy||(!attempt.held&&!attempt.retryable)||!receipt||receipt.request_key!==attempt.key)return false;
 if(['accepted','sent','delivered'].includes(receipt.state)){
  attempt.held=false;attempt.retryable=false;attempt.status=receipt.state==='delivered'?'Delivered.':'Sent. Delivery confirmation pending.';return true;
 }
 if(['ready','not_found','cancelled','failed'].includes(receipt.state)){
  attempt.held=false;attempt.retryable=['ready','not_found'].includes(receipt.state);attempt.status=attempt.retryable?'Text not sent. Your draft is ready to retry.':'Text was not delivered. Your draft is saved.';
 }else{attempt.held=true;attempt.status='Confirming delivery automatically…';}
 return false;
}
