import {db} from './stripe-test';
import {marketCountBodies,marketCounts,marketLocations} from './market-expansion';
type Job={id:string;kind:'locations'|'counts';city:string;state:string;zip:string|null;page:number};
export async function expandMarket(account:string,id:string){
 const key=process.env.DEALMACHINE_API_KEY;if(!key)return {status:'market_provider_missing'};
 const j=await db<Job|null>('rpc/icash_claim_market_research','POST',{p_account:account,p_job:id});if(!j)return {status:'market_research_held'};
 const request=async(path:string,body?:object)=>{
  if(!await db<boolean>('rpc/icash_take_dealmachine_request','POST',{}))throw Error('Market rate limit');
  const r=await fetch('https://api.v2.dealmachine.com/v1'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Market provider failed');return r.json();
 };
 try{
  if(j.kind==='locations'){
   const query=new URLSearchParams({q:j.city,state:j.state,type:'zip_code',per_page:'50',page:String(j.page)});
   const result=marketLocations.parse(await request('/locations?'+query));
   if(result.pagination.page!==j.page||result.data.some(v=>v.state!==j.state))throw Error('Market scope mismatch');
   await db('rpc/icash_save_market_research','POST',{p_account:account,p_job:id,p_result:{locations:result.data,nextPage:result.pagination.total_pages>j.page&&j.page<4?j.page+1:null}});
  }else{
   const results=[];
   for(const body of marketCountBodies(j.zip!))results.push(marketCounts.parse(await request('/properties/search/count',body)));
   await db('rpc/icash_save_market_research','POST',{p_account:account,p_job:id,p_result:{total:results[0].total_properties,highEquity:results[1].total_properties,potentialBuyers:results[2].total_people}});
  }
  return {status:'market_research_saved'};
 }catch{
  // Free checks can retry after backoff; at most three attempts per job.
  await db(`icash_market_research_jobs?id=eq.${id}&account_id=eq.${account}&state=eq.running`,'PATCH',{state:'held',next_attempt_at:new Date(Date.now()+3600000).toISOString()});
  return {status:'market_research_held'};
 }
}
