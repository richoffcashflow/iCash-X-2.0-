type Database=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
type Environment={VERCEL_ENV?:string;CONTIGUITY_API_KEY?:string;CONTIGUITY_WEBHOOK_SECRET?:string};
type Claim={id:string;request:{id:string;account_id:string;provider_id:string;sender:string;recipient:string}};
type Receipt={url:string;status:number;rawText:string;raw:unknown;checkedAt:string};
const origin='https://api.contiguity.com';
/** Read-only canonical receipts. Never call a send, cancellation or replay API. */
async function readReceipt(path:string,key:string,fetcher:typeof fetch,now:()=>number):Promise<Receipt>{
 const url=origin+path;
 const response=await fetcher(url,{method:'GET',headers:{Authorization:`Token ${key}`,Accept:'application/json'},
  cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(12000)});
 if(response.redirected||(response.url&&response.url!==url)){
  try{void response.body?.cancel().catch(()=>{});}catch{/* Preserve the original rejected response. */}
  throw Error('TEXT_RECEIPT_ORIGIN_MISMATCH');
 }
 // Bound the raw response while retaining exactly what the provider returned.
 const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let bytes=0;
 if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
  if(bytes>131072)throw Error('TEXT_RECEIPT_TOO_LARGE');chunks.push(value);}}finally{
  // A known read result must reach its original journal even when transport
  // cleanup never settles. Observe cleanup failures without holding this batch
  // or the maintenance heartbeat; no provider read or claim is repeated.
  try{void reader.cancel().catch(()=>{});}catch{/* Preserve the original read outcome. */}
  reader.releaseLock();
 }
 const rawText=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));let raw:unknown=null;
 try{raw=JSON.parse(rawText);}catch{/* Save the invalid original response; SQL will retain the hold. */}
 return {url,status:response.status,rawText,raw,checkedAt:new Date(now()).toISOString()};
}
/** The finalizer journals this exact attempt once and returns its saved outcome
 * on repetition. Recover a lost acknowledgment without another provider read,
 * new claim or changed receipt. Both database attempts share the original bound.
 */
async function finishReceipt(db:Database,id:string,receipt:Record<string,unknown>){
 const signal=AbortSignal.timeout(6000),body={p_id:id,p_receipt:receipt};
 for(let attempt=0;attempt<2;attempt++){
  signal.throwIfAborted();
  try{
   const outcome=await db<unknown>('rpc/icash_finish_text_delivery_recheck','POST',body,signal);
   if(typeof outcome!=='string'||!['delivered','needs_review','changed','held'].includes(outcome))throw Error('TEXT_RECEIPT_ACKNOWLEDGMENT_UNVERIFIED');
   return outcome;
  }catch(error){if(attempt===1||signal.aborted)throw error;}
 }
 throw Error('TEXT_RECEIPT_ACKNOWLEDGMENT_UNVERIFIED');
}
export async function recoverTextDeliveryReceipts(db:Database,env:Environment={VERCEL_ENV:process.env.VERCEL_ENV,CONTIGUITY_API_KEY:process.env.CONTIGUITY_API_KEY,CONTIGUITY_WEBHOOK_SECRET:process.env.CONTIGUITY_WEBHOOK_SECRET},fetcher:typeof fetch=fetch,now:()=>number=Date.now){
 const result={checked:0,delivered:0,review:0,held:0,changed:0,errors:0,readErrors:0};
 // Receipt reads remain independent of customer Pause and outbound-send flags.
 if(env.VERCEL_ENV!=='production'||!env.CONTIGUITY_API_KEY||!env.CONTIGUITY_WEBHOOK_SECRET)return {...result,status:'configuration_unavailable'};
 const claims=await db<Claim[]>('rpc/icash_claim_text_delivery_rechecks','POST',{},AbortSignal.timeout(6000));
 if(!claims.length)return {...result,status:'idle'};
 if(claims.length>3)throw Error('TEXT_RECEIPT_BATCH_INVALID');
 let lease:Receipt|undefined;
 try{lease=await readReceipt('/numbers/leased',env.CONTIGUITY_API_KEY,fetcher,now);}catch{/* Each claim still records an unavailable observation. */}
 const leaseData=lease?.raw as {object?:unknown;data?:{numbers?:unknown}}|null;
 const numbers=leaseData?.object==='response'&&Array.isArray(leaseData.data?.numbers)?leaseData.data.numbers:[];
 const leaseReadable=lease?.status===200&&leaseData?.object==='response'&&Array.isArray(leaseData.data?.numbers);
 // Saving a failed observation does not establish recovery-service health.
 if(!leaseReadable)result.readErrors++;
 const leased=(phone:string)=>numbers.some((value:unknown)=>typeof value==='object'&&value!==null&&
  (value as {number?:{e164?:unknown}}).number?.e164===phone);
 await Promise.all(claims.map(async claim=>{
  result.checked++;
  const receipt:Record<string,unknown>={source:'contiguity_canonical_get',lease:lease??null};
  // A current lease is required by SQL before applying delivery. Its absence
  // must not erase our opportunity to collect an already accepted original's
  // canonical evidence. The same claim, three-message cap and backoff apply.
  if(!leaseReadable||!leased(claim.request.sender))receipt.reason='leased_identity_unverified';
  try{
   if(!/^[A-Za-z0-9_-]{1,200}$/.test(claim.request.provider_id))receipt.reason='original_message_identity_invalid';
   else{
    const message=await readReceipt(`/conversations/history/message/${claim.request.provider_id}?tracking=true`,env.CONTIGUITY_API_KEY!,fetcher,now);
    receipt.message=message;
    const value=message.raw as {object?:unknown;data?:unknown}|null;
    // Missing/gone originals remain message-specific evidence holds.
    if(![404,410].includes(message.status)&&(message.status!==200||value?.object!=='response'||!value.data||typeof value.data!=='object'||Array.isArray(value.data)))result.readErrors++;
   }
  }catch{result.readErrors++;receipt.messageReadError='canonical_read_unavailable';receipt.reason??='canonical_read_unavailable';}
  try{
   const outcome=await finishReceipt(db,claim.id,receipt);
   if(outcome==='delivered')result.delivered++;else if(outcome==='needs_review')result.review++;
   else if(outcome==='changed')result.changed++;else result.held++;
  }catch{result.errors++;}
 }));
 return {...result,status:result.errors?'receipt_write_unavailable':result.readErrors?'receipt_read_unavailable':'checked'};
}
