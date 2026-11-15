import {randomUUID} from 'node:crypto';
import {dealMachineRequest,finishAdmittedDealMachineRequest,DealMachineQuotaError,type ResearchDb} from './dealmachine-request.ts';
import {OwnerPreviewRateLimitError} from './owner-enrichment-deferral.ts';

/** Only a durably saved, free preflight may wait on the existing unstarted
 * ticket mechanism. Its dedicated RPC independently verifies that evidence. */
export class OwnerExportPreflightPendingError extends OwnerPreviewRateLimitError {
 constructor(accountId:string,screeningId:string){super(accountId,screeningId);this.name='OwnerExportPreflightPendingError';this.message='OWNER_EXPORT_PREFLIGHT_PENDING';}
}
/** Waiting for original free-list deletion grants no expired-list contact
 * authority. Its dedicated deferral rechecks the exact current source. */
export class OwnerPreflightCleanupPendingError extends OwnerPreviewRateLimitError {
 readonly preflightId:string;
 constructor(accountId:string,screeningId:string,preflightId:string){super(accountId,screeningId);this.name='OwnerPreflightCleanupPendingError';this.message='OWNER_PREFLIGHT_CLEANUP_PENDING';this.preflightId=preflightId;}
}
/** A definite lock wait before this exact checking-source cleanup admission.
 * Its own deferral RPC must recheck that no DELETE was admitted meanwhile. */
export class OwnerCheckingCleanupPendingError extends OwnerPreviewRateLimitError {
 readonly preflightId:string;
 constructor(accountId:string,screeningId:string,preflightId:string){super(accountId,screeningId);this.name='OwnerCheckingCleanupPendingError';this.message='OWNER_CHECKING_CLEANUP_PENDING';this.preflightId=preflightId;}
}
type Claim={status:string;id:string;screeningId?:string;lease:string;listId:string|number;name:string;ids:string[];mobileOnly:boolean;nextStep?:'create'|'metadata'|'baseline'|'eligible'|null};
type Receipt={httpStatus:number|null;raw:unknown;rawText:string|null};
const listId=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v)||typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const internalId=(id:string)=>{const n=Number(id.slice(4));if(!/^per_[1-9][0-9]{0,15}$/.test(id)||!Number.isSafeInteger(n)||String(n)!==id.slice(4))throw Error('OWNER_PREFLIGHT_ID_INVALID');return n;};
async function readBody(response:Response,max=1048576){
 if(!response.body)throw Error('OWNER_PREFLIGHT_BODY_MISSING');
 const reader=response.body.getReader(),parts:Buffer[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('OWNER_PREFLIGHT_BODY_LIMIT');parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>null);}
 const rawText=Buffer.concat(parts).toString('utf8');let raw:unknown=null;try{raw=JSON.parse(rawText);}catch{}
 return {rawText,raw};
}
// A lost DB acknowledgment may reread/save the identical original receipt.
// It never repeats a provider operation or changes the persisted evidence.
async function saveOriginal<T>(db:ResearchDb,path:string,payload:unknown):Promise<T>{
 try{return await db<T>(path,'POST',payload);}catch{return db<T>(path,'POST',payload);}
}
export async function cleanupOwnerPreflight(db:ResearchDb,transport:typeof fetch=fetch,id:string|null=null){
 const key=process.env.DEALMACHINE_API_KEY;if(!key)return {status:'unconfigured'};
 const c=await db<{id:string;token:string;listId:string|number;accountId:string}|null>('rpc/icash_claim_owner_preflight_cleanup','POST',{p_id:id});
 if(!c)return {status:'idle'};if(!listId(c.listId))return {status:'held'};
 let receipt:Receipt={httpStatus:null,raw:null,rawText:null};
 let persistence:'unknown'|'confirmed'|'held'|'unavailable'='unknown';
 const recordCleanup=async()=>{
  try{
   const saved=await saveOriginal<boolean>(db,'rpc/icash_record_owner_preflight_cleanup',{p_id:c.id,p_token:c.token,p_receipt:receipt});
   persistence=saved===true?'confirmed':saved===false?'held':'unavailable';
  }catch(error){persistence='unavailable';throw error;}
 };
 const outcome=(confirmed:string)=>({status:persistence==='confirmed'?confirmed:persistence==='held'?'held':'cleanup_unavailable'});
 try{
  await dealMachineRequest(db,'owner_preview',async()=>{
   const r=await transport('https://api.v2.dealmachine.com/v1/lists/'+c.listId,{method:'DELETE',headers:{Authorization:'Bearer '+key},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)});
   receipt={httpStatus:r.status,...await readBody(r,65536)};
   await recordCleanup();
   return new Response(receipt.rawText,{status:r.status,headers:r.headers});
  },{accountId:c.accountId,operationKey:'owner-preflight-cleanup:'+c.id});
  return outcome('checked');
 }catch{
  await recordCleanup().catch(()=>null);
  return outcome('pending');
 }
}
type CleanupAttempt={status:'admitted';receiptPersistence:'confirmed'|'unconfirmed'|'unavailable'|'unknown';terminalReceipt:boolean}|{status:'quota_wait'|'pending'|'held'};
async function cleanupExpiredOwnerPreflight(db:ResearchDb,accountId:string,id:string,transport:typeof fetch,checking=false):Promise<CleanupAttempt>{
 const key=process.env.DEALMACHINE_API_KEY;if(!key){if(checking)throw Error('OWNER_CHECKING_CLEANUP_ADMISSION_UNAVAILABLE');return {status:'held'};}
 if(checking&&(!uuid(accountId)||!uuid(id)))throw Error('OWNER_CHECKING_CLEANUP_ADMISSION_INVALID');
 const requestId=randomUUID();
 // Do not replay an admission after an uncertain acknowledgment. An admitted
 // attempt keeps its original token/lease even when this worker loses it.
 let c:{status:string;id:string;accountId:string;token:string;listId:string|number;requestId:string};
 try{c=await db(checking?'rpc/icash_admit_expired_checking_cleanup':'rpc/icash_admit_owner_preflight_cleanup','POST',{p_account:accountId,p_id:id,p_request:requestId});}
 catch(error){if(checking)throw Error('OWNER_CHECKING_CLEANUP_ADMISSION_UNAVAILABLE');throw error;}
 if(c?.status!=='admitted'){
  if(c?.status==='quota_wait')return {status:'quota_wait'};
  if(c?.status==='pending'||c?.status==='busy')return {status:'pending'};
  if(!checking||c?.status==='held'||c?.status==='disabled')return {status:'held'};
  throw Error('OWNER_CHECKING_CLEANUP_ADMISSION_INVALID');
 }
 if(c.id!==id||c.accountId!==accountId||c.requestId!==requestId||!listId(c.listId)||typeof c.token!=='string'||(checking&&!uuid(c.token)))throw Error(checking?'OWNER_CHECKING_CLEANUP_ADMISSION_INVALID':'OWNER_PREFLIGHT_CLEANUP_CLAIM_INVALID');
 let receipt:Receipt={httpStatus:null,raw:null,rawText:null};
 let receiptPersistence:Extract<CleanupAttempt,{status:'admitted'}>['receiptPersistence']='unknown';
 const saveCleanup=async()=>{
  try{const saved=await saveOriginal<boolean>(db,'rpc/icash_record_owner_preflight_cleanup',{p_id:c.id,p_token:c.token,p_receipt:receipt});receiptPersistence=saved===true?'confirmed':'unconfirmed';}
  catch(error){receiptPersistence='unavailable';throw error;}
 };
 try{
  await finishAdmittedDealMachineRequest(db,requestId,async()=>{
   const r=await transport('https://api.v2.dealmachine.com/v1/lists/'+c.listId,{method:'DELETE',headers:{Authorization:'Bearer '+key},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)});
   receipt={httpStatus:r.status,...await readBody(r,65536)};
   await saveCleanup();
   return new Response(receipt.rawText,{status:r.status,headers:r.headers});
  });
 }catch{
  await saveCleanup().catch(()=>null);
 }
 let terminalReceipt=false;
 try{const raw=JSON.parse(receipt.rawText??'');terminalReceipt=receipt.httpStatus===404||receipt.httpStatus===200&&raw?.data?.deleted===true;}catch{/* Unknown/nonterminal provider receipt stays distinct from a database acknowledgment failure. */}
 return {status:'admitted',receiptPersistence,terminalReceipt};
}
/** The private checking-source journal authorizes only this atomic cleanup
 * admission. The ordinary claim still has to prove deletion before renewal. */
export async function cleanupExpiredCheckingOwnerPreflight(db:ResearchDb,accountId:string,id:string,transport:typeof fetch=fetch){
 return cleanupExpiredOwnerPreflight(db,accountId,id,transport,true);
}
/** A new list is indexed asynchronously even when its status is completed.
 * Creation and counting therefore use separate, bounded worker capabilities.
 * Positive counts only admit the unchanged active/DNC-filtered export. */
export async function preflightOwnerExport(db:ResearchDb,accountId:string,items:unknown[],request:unknown,transport:typeof fetch=fetch){
 const claim=()=>db<Claim>('rpc/icash_claim_owner_preflight','POST',{p_account:accountId,p_items:items,p_request:request});
 let c=await claim();
 if(c?.status==='cleanup_required'){
  const original=c;
  if(typeof original.id!=='string'||typeof original.screeningId!=='string')return {status:'held'};
  await cleanupExpiredOwnerPreflight(db,accountId,original.id,transport).catch(()=>null);
  // The receipt RPC can return false or lose its acknowledgment. Only the
  // ordinary claim can confirm deletion and admit one new immutable generation.
  c=await claim();
  if(c?.status==='cleanup_required'&&c.id===original.id)
   throw new OwnerPreflightCleanupPendingError(accountId,original.screeningId,original.id);
 }
 if(!c||!['create','check'].includes(c.status))return {status:c?.status??'held'};
 let result='held';
 const step=async(name:string,method:string,path:string,body:unknown)=>{
  let receipt:Receipt={httpStatus:null,raw:null,rawText:null},outcome='held';
  try{
   await dealMachineRequest(db,'owner_preview',async()=>{
    const r=await transport('https://api.v2.dealmachine.com/v1'+path,{method,headers:{Authorization:'Bearer '+process.env.DEALMACHINE_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    receipt={httpStatus:r.status,...await readBody(r)};
    outcome=await saveOriginal<string>(db,'rpc/icash_record_owner_preflight',{p_id:c.id,p_lease:c.lease,p_step:name,p_receipt:receipt});
    return new Response(receipt.rawText,{status:r.status,headers:r.headers});
   },{accountId,operationKey:'owner-preflight:'+c.id+':'+name});
  }catch(error){
   // A durable local refusal proves this exact request never reached the provider.
   // Keep its step unrecorded so a later, separately claimed handler can resume.
   if(error instanceof DealMachineQuotaError){
    const deferred=await saveOriginal<boolean>(db,'rpc/icash_defer_owner_preflight_quota',{p_id:c.id,p_lease:c.lease,p_step:name,p_request:error.requestId}).catch(()=>false);
    if(deferred)return 'pending';
   }
   outcome=await saveOriginal<string>(db,'rpc/icash_record_owner_preflight',{p_id:c.id,p_lease:c.lease,p_step:name,p_receipt:receipt}).catch(()=>'held');
  }
  return outcome;
 };
 try{
  if(!Array.isArray(c.ids)||!c.ids.length||c.ids.length>125||new Set(c.ids).size!==c.ids.length)throw Error('OWNER_PREFLIGHT_CLAIM_INVALID');
  if(c.status==='create'){
   if(c.name!=='icash-owner-preflight-'+c.id)throw Error('OWNER_PREFLIGHT_CLAIM_INVALID');
   result=await step('create','POST','/lists',{name:c.name,source_type:'people',record_ids:c.ids.map(internalId),add_as_prospects:false});
  }else{
   if(!listId(c.listId))throw Error('OWNER_PREFLIGHT_CLAIM_INVALID');
   const scope={include_lists:{people_list_ids:[c.listId]}};
   result=c.nextStep==='metadata'?await step('metadata','GET','/lists/'+c.listId,undefined):'checking';
   if(result==='checking'&&c.nextStep!=='eligible')result=await step('baseline','POST','/people/search/count',scope);
   if(result==='checking')result=await step('eligible','POST','/people/search/count',{...scope,filters:['has_active_phone_number','has_non_dnc_phone',...(c.mobileOnly?['has_wireless_phone']:[])].map(filter_id=>({filter_id,value:true}))});
  }
 }catch{result='held';}
 if(result!=='pending')await cleanupOwnerPreflight(db,transport,c.id).catch(()=>null);
 return {status:result};
}
