import {discoveryFields} from './discovery-pipeline.ts';
import {qualifySellerProperty,type SellerMarket} from './seller-qualification.ts';
export type SellerDb=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Lookup={id:string;token:string;address:string;assignmentFeeCents:number;sellerCostReserveCents:number};
/** One bounded paid address lookup per durable claim. A timeout is never replayed. */
export async function processSellerIntake(db:SellerDb,key:string|undefined,transport:typeof fetch=fetch){
 if(!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))return {status:'provider_not_configured'};
 const markets=await db<(SellerMarket&{major_city:boolean})[]>('icash_seller_markets?enabled=eq.true&major_city=eq.true&select=city,state,enabled,reviewed_until,review_ref,major_city&limit=501');
 if(markets.length>500)return {status:'market_configuration_requires_review'};
 // Rate admission precedes the claim so local throttling cannot strand a paid hold.
 if(!await db<boolean>('rpc/icash_take_dealmachine_request','POST',{}))return {status:'rate_limited'};
 const claim=await db<Lookup|null>('rpc/icash_claim_seller_lookup','POST',{});
 if(!claim)return {status:'idle_or_setup_required'};
 try{
  const r=await transport('https://api.v2.dealmachine.com/v1/enrichment/address',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({data:[{full_address:claim.address}],fields:[...discoveryFields,'property_type'],contact_audience:'none'}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Provider response needs review');
  const output=qualifySellerProperty(await r.json(),markets,{assignmentFeeCents:claim.assignmentFeeCents,sellerCostReserveCents:claim.sellerCostReserveCents});
  const saved=await db<boolean>('rpc/icash_finish_seller_lookup','POST',{p_id:claim.id,p_token:claim.token,p_output:output});
  return {status:saved?'property_checked':'lookup_requires_review'};
 }catch{
  // No release or retry: the provider may have charged even if no response arrived.
  return {status:'lookup_requires_review'};
 }
}
