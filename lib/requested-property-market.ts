import {db} from './stripe-test';
import {discoveryWorkEnabled} from './live-work-admission.ts';
export const usStateCodes=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
type Geo={location_id:string;type:'zip_code';code:string;name:string;state:string;property_count:number};
/** Exact provider geography only; never infer state from a prefix or accept a suggested neighboring ZIP. */
export function requestedZipLocation(raw:unknown,zip:string):Geo|null{
 if(!/^\d{5}$/.test(zip)||!raw||typeof raw!=='object')throw Error('Invalid location response');
 const r=raw as {data?:unknown;pagination?:{page?:unknown;total_pages?:unknown}};
 if(!Array.isArray(r.data)||r.data.length>100||r.pagination?.page!==1||!Number.isSafeInteger(r.pagination.total_pages)||Number(r.pagination.total_pages)<0)throw Error('Invalid location response');
 const exact=r.data.filter(v=>v&&typeof v==='object'&&(v as Geo).type==='zip_code'&&(v as Geo).code===zip) as Geo[];
 if(exact.length===0)return null;
 if(exact.length!==1)throw Error('Ambiguous location response');
 const geo=exact[0];
 if(geo.location_id!==`loc_zip_code_${zip}`||!usStateCodes.has(geo.state)||typeof geo.name!=='string'||geo.name.trim().length<1||geo.name.length>200||!Number.isSafeInteger(geo.property_count)||geo.property_count<0)throw Error('Invalid US ZIP response');
 return {location_id:geo.location_id,type:'zip_code',code:zip,name:geo.name.trim(),state:geo.state,property_count:geo.property_count};
}
/** Only a funded, authenticated owner's exact persisted ZIP request can claim a lookup. */
export async function resolveRequestedPropertyMarket(accountId:string,userId:string){
 if(!discoveryWorkEnabled())return {status:'held'};
 const key=process.env.DEALMACHINE_API_KEY;if(!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key??''))return {status:'provider_not_configured'};
 try{
  const claim=await db<{status:string;zip?:string;token?:string}>('rpc/icash_claim_requested_property_zip','POST',{p_user:userId,p_account:accountId});
  if(claim.status==='lookup_required'){
   if(!/^\d{5}$/.test(claim.zip??'')||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(claim.token??''))throw Error('Invalid lookup claim');
   if(!await db<boolean>('rpc/icash_take_dealmachine_request','POST',{}))return {status:'held'};
   const query=new URLSearchParams({q:claim.zip!,type:'zip_code',per_page:'100',page:'1'});
   const response=await fetch('https://api.v2.dealmachine.com/v1/locations?'+query,{headers:{Authorization:`Bearer ${key}`},method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('Location provider unavailable');
   const raw=await response.text();if(raw.length>256000)throw Error('Location response too large');
   const location=requestedZipLocation(JSON.parse(raw),claim.zip!);
   const saved=await db<{status:string}>('rpc/icash_save_requested_property_zip','POST',{p_user:userId,p_account:accountId,p_zip:claim.zip,p_token:claim.token,p_location:location});
   if(saved.status!=='known')return {status:saved.status};
  }else if(claim.status!=='known')return {status:claim.status};
  // This function creates configuration only. It never unpauses or reserves spend.
  const result=await db<{status:string}>('rpc/icash_provision_funded_account','POST',{p_account:accountId});
  return {status:result.status};
 }catch{return {status:'market_lookup_unavailable'};}
}
