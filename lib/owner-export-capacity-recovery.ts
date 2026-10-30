import {finishAdmittedDealMachineRequest,type ResearchDb} from './dealmachine-request.ts';

/** One reviewed FREE inventory read. Never repeats an export, downloads a file,
 * releases money, or attributes a history item to the unknown original owner. */
export async function recoverOwnerExportCapacity(db:ResearchDb,transport:typeof fetch=fetch,env=process.env){
 if(env.VERCEL_ENV!=='production'||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(env.DEALMACHINE_API_KEY??''))return {status:'not_requested'};
 const claim=await db<{reviewId:string;requestId:string}|null>('rpc/icash_claim_export_capacity_review','POST',{});
 if(!claim)return {status:'capacity_review_idle'};
 let received=false,status='capacity_review_held';
 try{
  await finishAdmittedDealMachineRequest(db,claim.requestId,async()=>{
   const response=await transport('https://api.v2.dealmachine.com/v1/exports?limit=100&offset=0',{
    method:'GET',headers:{Authorization:`Bearer ${env.DEALMACHINE_API_KEY}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
   });
   if(!response.body)throw Error('EXPORT_CAPACITY_RESPONSE_UNAVAILABLE');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)throw Error('EXPORT_CAPACITY_RESPONSE_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>null);}
   const rawText=Buffer.concat(chunks).toString('utf8');let raw:unknown=null;try{raw=JSON.parse(rawText);}catch{}
   const number=(name:string)=>{const value=response.headers.get(name);return value!==null&&/^\d{1,10}$/.test(value)?Number(value):null;};
   received=true;
   const result=await db<string>('rpc/icash_record_export_capacity_review','POST',{p_review:claim.reviewId,p_receipt:{httpStatus:response.status,raw,rawText,
    headers:{minuteRemaining:number('X-RateLimit-Remaining'),dayRemaining:number('X-RateLimit-Day-Remaining')}}});
   if(result==='capacity_verified')status='capacity_verified';
   return new Response(rawText,{status:response.status,headers:response.headers});
  });
 }catch{
  if(!received)await db('rpc/icash_record_export_capacity_review','POST',{p_review:claim.reviewId,p_receipt:{httpStatus:null,raw:null,rawText:'',outcome:'read_unavailable'}}).catch(()=>null);
 }
 return {status};
}
