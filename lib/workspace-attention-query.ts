const attentionStates = {
 icash_text_attention: 'eq.open',
 icash_sms_call_requests: 'eq.needs_review',
 icash_handoffs: 'neq.resolved',
 icash_signing_envelopes: 'eq.customer_signature_needed',
 icash_buyer_viewing_requests: 'eq.needs_confirmation',
 icash_seller_gaps: 'eq.needs_review',
 icash_closing_setup: 'eq.needs_review'
} as const;
export type WorkspaceAttentionTable = keyof typeof attentionStates;
export const workspaceAttentionTables = Object.keys(attentionStates) as WorkspaceAttentionTable[];

// Apply property visibility inside the database query, before LIMIT/OFFSET.
// Retained agreements and requests are history once their property is archived.
// This queue is independent of the currently displayed property page/search.
export function workspaceAttentionQuery(table:WorkspaceAttentionTable,accountId:string,options:{select?:string;order?:string;limit:number;offset?:number}){
 const throughDeal=table==='icash_signing_envelopes';
 const property='active_property:icash_screening_jobs!inner()';
 const relation=throughDeal?`active_deal:icash_deal_files!inner(${property})`:property;
 const prefix=throughDeal?'active_deal.active_property':'active_property';
 const params=new URLSearchParams({
  account_id:`eq.${accountId}`,state:attentionStates[table],
  select:`${options.select??'id'},${relation}`,
  [`${prefix}.account_id`]:`eq.${accountId}`,[`${prefix}.state`]:'eq.complete'
 });
 if(throughDeal)params.set('active_deal.account_id',`eq.${accountId}`);
 if(table==='icash_handoffs')params.set('portal_journey_id','is.null');
 if(options.order)params.set('order',options.order);
 params.set('limit',String(options.limit));
 if(options.offset!==undefined)params.set('offset',String(options.offset));
 return `${table}?${params}`;
}
