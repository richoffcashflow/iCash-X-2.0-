import {finishAdmittedDealMachineRequest,type ResearchDb} from './dealmachine-request.ts';

type Probe='inventory'|'pending'|'processing';
type Receipt={httpStatus:number|null;raw:unknown;rawText:string;headers?:{minuteRemaining:number|null;dayRemaining:number|null;date:string|null;age:string|null};outcome?:string};
async function saveProbe(db:ResearchDb,reviewId:string,probe:Probe,receipt:Receipt){
 // Only the identical evidence write may be retried after acknowledgment loss.
 for(let attempt=0;attempt<2;attempt++)try{
  return await db<boolean>('rpc/icash_record_export_capacity_probe','POST',{p_review:reviewId,p_probe:probe,p_receipt:receipt});
 }catch{if(attempt===1)return false;}
 return false;
}
async function readReceipt(response:Response):Promise<Receipt>{
 if(!response.body)throw Error('CAPACITY_BODY_UNAVAILABLE');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)throw Error('CAPACITY_BODY_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>null);reader.releaseLock();}
 const rawText=Buffer.concat(chunks).toString('utf8');let raw:unknown=null;try{raw=JSON.parse(rawText);}catch{}
 const number=(name:string)=>{const value=response.headers.get(name);return value!==null&&/^\d{1,10}$/.test(value)?Number(value):null;};
 // Retain original provider freshness evidence for database validation. Never
 // replace a missing Date with our clock or an invalid Age with an absent one.
 const date=response.headers.get('Date'),age=response.headers.get('Age');
 if((date!==null&&date.length>128)||(age!==null&&age.length>32))throw Error('CAPACITY_HEADERS_TOO_LARGE');
 return {httpStatus:response.status,raw,rawText,headers:{minuteRemaining:number('X-RateLimit-Remaining'),dayRemaining:number('X-RateLimit-Day-Remaining'),date,age}};
}

/** Three quota-bound FREE reads. Status filters cover an arbitrarily long export
 * history; the unfiltered page also proves recent, nonempty organization data.
 * Original exports, owner exclusions and financial holds are never replayed. */
export async function recoverAutomaticOwnerExportCapacity(db:ResearchDb,transport:typeof fetch=fetch,env=process.env){
 const release=env.VERCEL_GIT_COMMIT_SHA??env.RAILWAY_GIT_COMMIT_SHA;
 if(env.VERCEL_ENV!=='production'||!/^dm_sk_live_[A-Za-z0-9_-]+$/.test(env.DEALMACHINE_API_KEY??'')||!release||!/^[a-f0-9]{40}$/.test(release))return null;
 const claim=await db<{reviewId:string;requestId:string}|null>('rpc/icash_claim_automatic_export_capacity','POST',{p_release:release});
 if(!claim)return null;
 const deadline=AbortSignal.timeout(55000);
 try{
  const readProbe=async(probe:Probe,requestId:string)=>{
   deadline.throwIfAborted();
   let received:Receipt|null=null,saved=false;
   try{
    await finishAdmittedDealMachineRequest(db,requestId,async()=>{
     const response=await transport('https://api.v2.dealmachine.com/v1/exports?limit=100&offset=0'+(probe==='inventory'?'':`&status=${probe}`),{
      method:'GET',headers:{Authorization:`Bearer ${env.DEALMACHINE_API_KEY}`,'Cache-Control':'no-cache, max-age=0'},redirect:'error',cache:'no-store',signal:AbortSignal.any([deadline,AbortSignal.timeout(25000)]),
     });
     received=await readReceipt(response);
     saved=await saveProbe(db,claim.reviewId,probe,received);
     return new Response(received.rawText,{status:response.status,headers:response.headers});
    });
   }catch{
    if(!received)await saveProbe(db,claim.reviewId,probe,{httpStatus:null,raw:null,rawText:'',outcome:'read_unavailable'});
    return false;
   }
   const receipt=received as Receipt|null;
   return saved&&receipt?.httpStatus===200&&receipt.raw!==null&&!!receipt.headers?.minuteRemaining&&!!receipt.headers?.dayRemaining;
  };
  // Admission uses a nonblocking shared lock, so claim sequentially. Only the
  // independent provider reads overlap; await every admitted read to finish.
  if(await readProbe('inventory',claim.requestId)){
   const requests:{probe:Probe;requestId:string}[]=[];
   try{
    for(const probe of ['pending','processing'] as const){
     deadline.throwIfAborted();
     const requestId=await db<string|null>('rpc/icash_claim_export_capacity_probe','POST',{p_review:claim.reviewId,p_probe:probe});
     if(!requestId)break;
     requests.push({probe,requestId});
    }
   }finally{await Promise.allSettled(requests.map(({probe,requestId})=>readProbe(probe,requestId)));}
  }
 }catch{/* The next automatic attempt is a separate free check after backoff. */}
 // Finalization reads the durable probe receipts, including writes whose
 // responses were lost. A failed final acknowledgment cannot repeat a GET.
 for(let attempt=0;attempt<2;attempt++)try{
  const status=await db<string>('rpc/icash_finish_automatic_export_capacity','POST',{p_review:claim.reviewId});
  return {status:status==='capacity_verified'?'capacity_verified':'capacity_review_held'};
 }catch{if(attempt===1)return {status:'capacity_review_held'};}
 return {status:'capacity_review_held'};
}
