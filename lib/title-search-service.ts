import {db} from '@/lib/stripe-test';
/** Free shared-directory lookup. Missing coverage requires first-party research, never paid fallback. */
export async function discoverTitlePlaces(accountId:string,dealId:string){
 const [d]=await db<{terms:{state:string};stage:string}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=terms,stage`);
 const [a]=await db<{market:string;expires_at:string;purchase_envelope_id:string}[]>(`icash_disposition_authorities?deal_id=eq.${dealId}&account_id=eq.${accountId}&select=market,expires_at,purchase_envelope_id`);
 if(!d||!a||!['under_contract','buyer_selected'].includes(d.stage)||!a.market||a.market.length>120||! /^[A-Z]{2}$/.test(d.terms.state)||Date.parse(a.expires_at)<=Date.now())return {status:'title_search_held'};
 const [signed]=await db<{id:string}[]>(`icash_signing_envelopes?id=eq.${a.purchase_envelope_id}&account_id=eq.${accountId}&deal_id=eq.${dealId}&state=eq.completed&test_mode=eq.false&select=id`);if(!signed)return {status:'signed_purchase_required'};
 const known=await db<{id:string}[]>(`icash_title_directory?claimed_states=cs.{${d.terms.state}}&status=neq.rejected&contact_checked_until=gt.${new Date().toISOString()}&select=id&limit=1`);if(known.length)return {status:'directory_candidates_available'};
 return {status:'title_directory_research_required'};
}
