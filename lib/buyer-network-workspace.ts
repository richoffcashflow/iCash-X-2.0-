/** Account-wide existence check, independent of the lead page and search. */
export function buyerNetworkDealQuery(accountId:string,dealId:string|null=null){
 const params=new URLSearchParams({
  account_id:`eq.${accountId}`,stage:'not.in.(closed,canceled,cancelled,cancellation_pending)',
  select:'id,icash_signing_envelopes!inner(),icash_screening_jobs!inner()',
  'icash_signing_envelopes.account_id':`eq.${accountId}`,
  'icash_signing_envelopes.kind':'eq.purchase','icash_signing_envelopes.state':'eq.completed',
  'icash_signing_envelopes.test_mode':'eq.false',
  'icash_screening_jobs.account_id':`eq.${accountId}`,'icash_screening_jobs.state':'eq.complete',limit:'1'
 });
 if(dealId)params.set('id',`eq.${dealId}`);
 return `icash_deal_files?${params}`;
}
