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

// An expired automatic no-response reminder is history once delivery is known.
// The empty LEFT embed is used only as a receipt predicate; never return its body.
export const sellerReminderDeliveryEmbed='completed_reminder:icash_text_messages!outgoing_id()';
export function sellerAttentionFilters(accountId:string,prefix='',now=new Date().toISOString()){
 const params=new URLSearchParams();
 const key=(name:string)=>prefix?`${prefix}.${name}`:name;
 params.set(key('and'),`(or(review_reason.is.null,review_reason.neq.contact_checks_expired),or(state.is.null,state.neq.needs_review,review_reason.not.is.null,reason.is.null,reason.neq.no_response,stage.is.null,stage.neq.draft,expires_at.is.null,expires_at.gt.${now},completed_reminder.is.null))`);
 params.set(key('completed_reminder.account_id'),`eq.${accountId}`);
 params.set(key('completed_reminder.direction'),'eq.outgoing');
 params.set(key('completed_reminder.state'),'eq.delivered');
 params.set(key('completed_reminder.customer_author_id'),'is.null');
 return params;
}

// Response views preserve saved source rows but exclude verified automated notices.
export function workspaceAttentionSource(table:string){
 return ({icash_handoffs:'icash_response_handoffs',icash_text_attention:'icash_response_text_attention',icash_sms_call_requests:'icash_response_sms_call_requests',icash_seller_gaps:'icash_response_seller_gaps'} as Record<string,string>)[table]??table;
}

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
  select:`${options.select??'id'},${relation}${table==='icash_seller_gaps'?','+sellerReminderDeliveryEmbed:''}`,
  [`${prefix}.account_id`]:`eq.${accountId}`,[`${prefix}.state`]:'eq.complete'
 });
 if(throughDeal)params.set('active_deal.account_id',`eq.${accountId}`);
 if(table==='icash_handoffs')params.set('portal_journey_id','is.null');
 // Expired background contact checks have no customer action. Keep their saved
 // state for diagnostics, but omit them before paging customer attention.
 if(table==='icash_seller_gaps')for(const [key,value] of sellerAttentionFilters(accountId))params.set(key,value);
 if(options.order)params.set('order',options.order);
 params.set('limit',String(options.limit));
 if(options.offset!==undefined)params.set('offset',String(options.offset));
 return `${workspaceAttentionSource(table)}?${params}`;
}
