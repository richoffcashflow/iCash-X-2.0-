import {db} from '@/lib/stripe-test';
import {dispatchReservedOperation} from '@/lib/operating-costs';
/** Google discovery stores only place IDs. Directory contacts need independent first-party verification. */
export async function discoverTitlePlaces(accountId:string,dealId:string){
 if(!process.env.GOOGLE_PLACES_API_KEY)return {status:'google_places_key_required'};
 const [d]=await db<{terms:{state:string};stage:string}[]>(`icash_deal_files?id=eq.${dealId}&account_id=eq.${accountId}&select=terms,stage`);
 const [a]=await db<{market:string;expires_at:string;purchase_envelope_id:string}[]>(`icash_disposition_authorities?deal_id=eq.${dealId}&account_id=eq.${accountId}&select=market,expires_at,purchase_envelope_id`);
 if(!d||!a||!['under_contract','buyer_selected'].includes(d.stage)||!a.market||a.market.length>120||! /^[A-Z]{2}$/.test(d.terms.state)||Date.parse(a.expires_at)<=Date.now())return {status:'title_search_held'};
 const [signed]=await db<{id:string}[]>(`icash_signing_envelopes?id=eq.${a.purchase_envelope_id}&account_id=eq.${accountId}&deal_id=eq.${dealId}&state=eq.completed&test_mode=eq.false&select=id`);if(!signed)return {status:'signed_purchase_required'};
 const known=await db<{id:string}[]>(`icash_title_directory?claimed_states=cs.{${d.terms.state}}&status=neq.rejected&contact_checked_until=gt.${new Date().toISOString()}&select=id&limit=1`);if(known.length)return {status:'directory_candidates_available'};
 const [rate]=await db<{id:string}[]>(`icash_operation_rates?operation=eq.title_search&enabled=eq.true&expires_at=gt.${new Date().toISOString()}&order=verified_at.desc&limit=1&select=id`);if(!rate)return {status:'title_search_rate_required'};
 const operationKey=`title-search:${dealId}`;
 const [prior]=await db<{state:string}[]>(`icash_operation_spend?operation_key=eq.${operationKey}&account_id=eq.${accountId}&select=state`);if(prior)return {status:'title_search_already_attempted'};
 await dispatchReservedOperation({accountId,operationKey,rateId:rate.id,permissionUntil:a.expires_at},async()=>{
 const r=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'X-Goog-Api-Key':process.env.GOOGLE_PLACES_API_KEY!,'X-Goog-FieldMask':'places.id','Content-Type':'application/json'},body:JSON.stringify({textQuery:`title company in ${a.market}, ${d.terms.state}`,pageSize:5,regionCode:'US'}),redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Title search needs reconciliation');const body=await r.json();
 if(body.places!==undefined&&!Array.isArray(body.places))throw Error('Invalid search response');
 const ids=[...new Set((body.places??[]).map((p:{id:unknown})=>p.id).filter((id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,300}$/.test(id)))].slice(0,5);
 await db('icash_title_search_results','POST',{operation_key:operationKey,account_id:accountId,deal_id:dealId,place_ids:ids});
 });
 return {status:'title_places_found_need_contact_verification'};
}
