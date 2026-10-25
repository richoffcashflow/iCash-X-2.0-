import {dealMachineRequest,DealMachineQuotaError,type ResearchDb} from './dealmachine-request.ts';
type Claim={action:'create'|'recover'|'sync';token:string;name:string;listId:string|null;ids:string[]};
const listId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
/** Only provider property IDs are filed; no customer identity, conversations or
 * prospect creation. Adding an existing ID is documented as free/idempotent. */
export async function syncResearchExclusions(db:ResearchDb,request:typeof fetch=fetch){
 const key=process.env.DEALMACHINE_API_KEY;if(!key)return {status:'unconfigured'};
 const c=await db<Claim|null>('rpc/icash_claim_research_exclusions','POST',{});
 if(!c)return {status:'not_due'};
 if(!['create','recover','sync'].includes(c.action)||!listId(c.token)||!/^research-exclusions-[a-f0-9-]{36}$/.test(c.name)||!Array.isArray(c.ids)||c.ids.length>1000||c.ids.some(x=>!/^prop_[0-9]{1,20}$/.test(x))||c.action==='sync'&&!listId(c.listId))throw Error('RESEARCH_EXCLUSION_CLAIM_INVALID');
 const finish=(result:object)=>db('rpc/icash_finish_research_exclusions','POST',{p_token:c.token,p_result:result});
 try{
  const endpoint=c.action==='sync'?`/lists/${c.listId}/items`:c.action==='recover'?'/lists?page=1&per_page=100':'/lists';
  const body=c.action==='create'?{name:c.name,source_type:'properties',add_as_prospects:false}:c.action==='sync'?{ids:c.ids,id_type:'internal_property_id',add_as_prospects:false}:null;
  const r=await dealMachineRequest(db,c.action==='create'?'exclusion_create':'exclusion_sync',()=>request('https://api.v2.dealmachine.com/v1'+endpoint,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)}));
  if(!r.ok)throw Error('RESEARCH_EXCLUSION_RESPONSE');
  const raw=object(r.raw);let data=object(raw.data);
  if(c.action==='recover'){
   const matches=Array.isArray(raw.data)?raw.data.filter(x=>object(x).name===c.name&&object(x).source_type==='properties'):[];
   if(matches.length!==1)throw Error('RESEARCH_EXCLUSION_UNCERTAIN');data=object(matches[0]);
  }
  if(c.action==='sync'){
   if(!Number.isSafeInteger(data.added)||Number(data.added)<0||Number(data.added)>c.ids.length)throw Error('RESEARCH_EXCLUSION_RECEIPT');
   await finish({ok:true,listId:c.listId,ids:c.ids,added:data.added});
  }else{
   if(!listId(data.list_id)||data.name!==c.name||data.source_type!=='properties'||data.status!=='completed')throw Error('RESEARCH_EXCLUSION_IDENTITY');
   await finish({ok:true,listId:data.list_id,name:data.name});
  }
  return {status:'synced'};
 }catch(error){await finish({ok:false,unstarted:error instanceof DealMachineQuotaError}).catch(()=>null);return {status:'pending'};}
}
