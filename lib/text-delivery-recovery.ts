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
 if(response.redirected||(response.url&&response.url!==url))throw Error('TEXT_RECEIPT_ORIGIN_MISMATCH');
 // Bound the raw response while retaining exactly what the provider returned.
 const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let bytes=0;
 if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
  if(bytes>131072)throw Error('TEXT_RECEIPT_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const rawText=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));let raw:unknown=null;
 try{raw=JSON.parse(rawText);}catch{/* Save the invalid original response; SQL will retain the hold. */}
 return {url,status:response.status,rawText,raw,checkedAt:new Date(now()).toISOString()};
}
export async function recoverTextDeliveryReceipts(db:Database,env:Environment={VERCEL_ENV:process.env.VERCEL_ENV,CONTIGUITY_API_KEY:process.env.CONTIGUITY_API_KEY,CONTIGUITY_WEBHOOK_SECRET:process.env.CONTIGUITY_WEBHOOK_SECRET},fetcher:typeof fetch=fetch,now:()=>number=Date.now){
 const result={checked:0,delivered:0,review:0,held:0,changed:0,errors:0};
 // Receipt reads remain independent of customer Pause and outbound-send flags.
 if(env.VERCEL_ENV!=='production'||!env.CONTIGUITY_API_KEY||!env.CONTIGUITY_WEBHOOK_SECRET)return {...result,status:'configuration_unavailable'};
 const claims=await db<Claim[]>('rpc/icash_claim_text_delivery_rechecks','POST',{},AbortSignal.timeout(6000));
 if(!claims.length)return {...result,status:'idle'};
 if(claims.length>3)throw Error('TEXT_RECEIPT_BATCH_INVALID');
 let lease:Receipt|undefined;
 try{lease=await readReceipt('/numbers/leased',env.CONTIGUITY_API_KEY,fetcher,now);}catch{/* Each claim still records an unavailable observation. */}
 const leaseData=lease?.raw as {object?:unknown;data?:{numbers?:unknown}}|null;
 const numbers=leaseData?.object==='response'&&Array.isArray(leaseData.data?.numbers)?leaseData.data.numbers:[];
 const leased=(phone:string)=>numbers.some((value:unknown)=>typeof value==='object'&&value!==null&&
  (value as {number?:{e164?:unknown}}).number?.e164===phone);
 await Promise.all(claims.map(async claim=>{
  result.checked++;
  const receipt:Record<string,unknown>={source:'contiguity_canonical_get',lease:lease??null};
  try{
   if(!lease||lease.status!==200||!leased(claim.request.sender))receipt.reason='leased_identity_unverified';
   else if(!/^[A-Za-z0-9_-]{1,200}$/.test(claim.request.provider_id))receipt.reason='original_message_identity_invalid';
   else receipt.message=await readReceipt(`/conversations/history/message/${claim.request.provider_id}`,env.CONTIGUITY_API_KEY!,fetcher,now);
  }catch{receipt.reason='canonical_read_unavailable';}
  try{
   const outcome=await db<string>('rpc/icash_finish_text_delivery_recheck','POST',{p_id:claim.id,p_receipt:receipt},AbortSignal.timeout(6000));
   if(outcome==='delivered')result.delivered++;else if(outcome==='needs_review')result.review++;
   else if(outcome==='changed')result.changed++;else result.held++;
  }catch{result.errors++;}
 }));
 return {...result,status:result.errors?'receipt_write_unavailable':'checked'};
}
