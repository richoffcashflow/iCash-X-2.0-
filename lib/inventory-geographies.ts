type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Claim={state:string;page:number;token:string};
/** One free geography request per maintenance invocation. No property retrieval,
 * owner enrichment, customer debit or outbound communication is reachable here. */
export async function refreshInventoryGeographies(db:Database,request:typeof fetch=fetch){
 const key=process.env.DEALMACHINE_API_KEY;
 if(!key||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(key))return {status:'provider_unavailable'};
 const claim=await db<Claim|null>('rpc/icash_claim_inventory_geographies','POST',{});
 if(!claim)return {status:'not_due'};
 if(!/^[A-Z]{2}$/.test(claim.state)||!Number.isSafeInteger(claim.page)||claim.page<1||claim.page>1000||!/^[-a-f0-9]{36}$/i.test(claim.token))throw Error('INVENTORY_METADATA_CLAIM_INVALID');
 const finish=(result:unknown)=>db<number>('rpc/icash_save_inventory_geographies','POST',{p_state:claim.state,p_page:claim.page,p_token:claim.token,p_result:result});
 try{
  if(!await db<boolean>('rpc/icash_take_dealmachine_request','POST',{})){await finish(null);return {status:'rate_limited'};}
  const query=new URLSearchParams({q:claim.state,state:claim.state,type:'zip_code',per_page:'100',page:String(claim.page)});
  const response=await request('https://api.v2.dealmachine.com/v1/locations?'+query,{method:'GET',headers:{Authorization:`Bearer ${key}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('INVENTORY_METADATA_UNAVAILABLE');
  const result=await response.json();
  const count=await finish(result);
  return {status:'metadata_saved',zipCount:count};
 }catch{
  await finish(null);
  return {status:'metadata_unavailable'};
 }
}

/** Four independently leased pages per minute: at most 400 free ZIP metadata
 * rows. The shared API limiter leaves paid research and contact checks in control.
 */
export async function refreshInventoryGeographyBatch(db:Database,request:typeof fetch=fetch){
 const results=await Promise.allSettled(Array.from({length:4},()=>refreshInventoryGeographies(db,request)));
 return {pages:results.map(result=>result.status==='fulfilled'?result.value:{status:'metadata_unavailable'})};
}
