import assert from 'node:assert/strict';
import {recoverTextDeliveryReceipts} from '../lib/text-delivery-recovery.ts';

const env={VERCEL_ENV:'production',CONTIGUITY_API_KEY:'fixture-key',CONTIGUITY_WEBHOOK_SECRET:'fixture-secret'};
const sender='+17205550100';
const claims=[1,2,3].map(n=>({id:`claim-${n}`,request:{id:`message-${n}`,account_id:`account-${n}`,provider_id:`provider-${n}`,sender,recipient:'+12145550101'}}));
for(const failure of ['lease_network','none','lease_http','lease_json','lease_shape','message_network','message_http','message_missing','message_gone','message_json','message_shape','message_write','read_and_write','sender_missing']){
 const saved=[],calls=[];
 const db=async(path,method,body)=>{
  assert.equal(method,'POST');
  if(path==='rpc/icash_claim_text_delivery_rechecks')return claims;
  assert.equal(path,'rpc/icash_finish_text_delivery_recheck','Recovery never creates a message or changes a money operation');
  saved.push(body);
  if(['message_write','read_and_write'].includes(failure)&&body.p_id==='claim-1')throw Error('private database detail');
  const message=body.p_receipt.message;
  return body.p_receipt.reason||message?.status!==200||message.raw?.object!=='response'||!message.raw.data||typeof message.raw.data!=='object'?'held':'delivered';
 };
 const fetcher=async(url,options)=>{
  calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert(options.signal);
  if(url.endsWith('/numbers/leased')){
   if(failure==='lease_network')throw Error('private lease detail');
   if(failure==='lease_http')return Response.json({error:'private'}, {status:503});
   if(failure==='lease_json')return new Response('{invalid');
   if(failure==='lease_shape')return Response.json({object:'response',data:{numbers:null}});
   return Response.json({object:'response',data:{numbers:[{number:{e164:failure==='sender_missing'?'+17205550999':sender}}]}});
  }
  assert(url.endsWith('?tracking=true'));
  if(url.includes('/provider-1?')){
   if(['message_network','read_and_write'].includes(failure))throw Error('private message detail');
   if(failure==='message_http')return Response.json({error:'private'}, {status:503});
   if(failure==='message_missing')return Response.json({error:'missing'}, {status:404});
   if(failure==='message_gone')return Response.json({error:'gone'}, {status:410});
   if(failure==='message_json')return new Response('{invalid');
   if(failure==='message_shape')return Response.json({object:'response',data:null});
  }
  return Response.json({object:'response',data:{status:'delivered'}});
 };
 const result=await recoverTextDeliveryReceipts(db,env,fetcher);
 const readFailed=failure.startsWith('lease_')||['message_network','message_http','message_json','message_shape','read_and_write'].includes(failure);
 const writeFailed=['message_write','read_and_write'].includes(failure);
 assert.equal(result.status,writeFailed?'receipt_write_unavailable':readFailed?'receipt_read_unavailable':'checked',failure);
 assert.equal(result.readErrors,readFailed?1:0,failure+' counts failed reads, not held message rows');
 assert.equal(result.errors,writeFailed?1:0,failure+' retains write failure counts');
 assert.equal(saved.length,writeFailed?4:3,'Every already-claimed row records its observation despite another failure; only failed acknowledgment retries');
 if(writeFailed){
  const repeated=saved.filter(row=>row.p_id==='claim-1');assert.equal(repeated.length,2);
  assert.deepEqual(repeated[0],repeated[1],'Retry retains the original attempt and exact provider evidence');
 }
 assert.equal(calls.length,4,'Original message evidence is collected despite current lease failure, without provider retry');
 assert.equal(result.checked,3);
 if(failure==='lease_http')for(const row of saved)assert.equal(row.p_receipt.lease.status,503,'Original failed raw receipt is retained');
 if(failure==='message_http')assert.equal(saved.find(row=>row.p_id==='claim-1').p_receipt.message.status,503);
 if(['message_network','read_and_write'].includes(failure)){
  assert.equal(saved.find(row=>row.p_id==='claim-1').p_receipt.reason,'canonical_read_unavailable');
  assert.equal(saved.find(row=>row.p_id==='claim-1').p_receipt.messageReadError,'canonical_read_unavailable');
 }
 if(failure.startsWith('message_')||failure==='read_and_write')assert.equal(result.delivered,2,'Independent original receipts finish');
 if(failure==='sender_missing')assert.equal(result.held,3,'Missing sender authority is an ordinary hold, not permission to change routes');
 if(failure.startsWith('lease_')){assert.equal(result.held,3);assert.equal(result.delivered,0,'Failed lease reads cannot establish delivery');}
}
// An HTTP success without a known SQL outcome does not acknowledge the journal.
for(const unknown of [undefined,null,false,{},'','pending']){
 let finishes=0,providerReads=0;
 const db=async(path,method,body)=>{
  if(path==='rpc/icash_claim_text_delivery_rechecks')return [claims[0]];
  finishes++;assert.equal(body.p_id,claims[0].id);return unknown;
 };
 const fetcher=async url=>{providerReads++;return Response.json(url.endsWith('/numbers/leased')?{object:'response',data:{numbers:[{number:{e164:sender}}]}}:{object:'response',data:{status:'delivered'}});};
 const result=await recoverTextDeliveryReceipts(db,env,fetcher);
 assert.equal(finishes,2);assert.equal(providerReads,2);
 assert.equal(result.errors,1);assert.equal(result.delivered,0);assert.equal(result.held,0);
 assert.equal(result.status,'receipt_write_unavailable','Unknown acknowledgment cannot become a successfully saved hold');
}
// Once the existing six-second database deadline expires, do not start a retry.
const originalTimeout=AbortSignal.timeout,controller=new AbortController();
let deadlineWrites=0,deadlineReads=0;
try{
 AbortSignal.timeout=ms=>ms===6000?controller.signal:originalTimeout(ms);
 const result=await recoverTextDeliveryReceipts(async(path,method,body,signal)=>{
  if(path==='rpc/icash_claim_text_delivery_rechecks')return [claims[0]];
  deadlineWrites++;assert.equal(signal,controller.signal);controller.abort();throw Error('Fixture database deadline expired');
 },env,async url=>{deadlineReads++;return Response.json(url.endsWith('/numbers/leased')?{object:'response',data:{numbers:[{number:{e164:sender}}]}}:{object:'response',data:{status:'delivered'}});});
 assert.equal(deadlineWrites,1);assert.equal(deadlineReads,2);assert.equal(result.errors,1);assert.equal(result.status,'receipt_write_unavailable');
}finally{AbortSignal.timeout=originalTimeout;}

// Transport cleanup is not receipt evidence. Once a bounded read has failed,
// canceling its unread body must not retain the original journal or suppress
// independent message receipts. These fixtures use native unfinished streams.
const flush=()=>new Promise(resolve=>setImmediate(resolve));
for(const target of ['lease','message'])for(const invalid of ['oversized','origin'])for(const cleanup of ['pending','rejected','synchronous']){
 const saved=[],calls=[];let cancelCount=0,rejectCleanup;
 const cleanupWait=new Promise((_,reject)=>{rejectCleanup=reject;});
 const response=new Response(new ReadableStream({
  start(controller){controller.enqueue(new Uint8Array(invalid==='oversized'?131073:1));},
  cancel(){cancelCount++;return cleanup==='rejected'?Promise.reject(Error('private cleanup')):cleanupWait;},
 }));
 if(invalid==='origin')Object.defineProperty(response,'url',{value:'https://wrong-origin.invalid/private'});
 if(cleanup==='synchronous'){
  if(invalid==='origin')response.body.cancel=()=>{cancelCount++;throw Error('private cleanup');};
  else{
   const getReader=response.body.getReader.bind(response.body);
   response.body.getReader=()=>{const reader=getReader();reader.cancel=()=>{cancelCount++;throw Error('private cleanup');};return reader;};
  }
 }
 const db=async(path,method,body)=>{
  assert.equal(method,'POST');
  if(path==='rpc/icash_claim_text_delivery_rechecks')return claims;
  assert.equal(path,'rpc/icash_finish_text_delivery_recheck');saved.push(body);
  return body.p_receipt.reason?'held':'delivered';
 };
 let result,error,settled=false;
 const pending=recoverTextDeliveryReceipts(db,env,async(url,options)=>{
  calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  if(target==='lease'&&url.endsWith('/numbers/leased')||target==='message'&&url.includes('/provider-1?'))return response;
  return Response.json(url.endsWith('/numbers/leased')?{object:'response',data:{numbers:[{number:{e164:sender}}]}}:{object:'response',data:{status:'delivered'}});
 }).then(value=>{result=value;settled=true;},failure=>{error=failure;settled=true;});
 try{
  await flush();await flush();
  assert.equal(settled,true,`${target}/${invalid}/${cleanup}: known read failure must not wait for transport cleanup`);
  await pending;assert.equal(error,undefined);
  assert.equal(cancelCount,1,'Start cleanup once without a provider request retry');
  assert.equal(response.body.locked,false,'Always release the bounded reader');
  assert.equal(calls.length,4,'One original lease read and three original message reads');
  assert.equal(saved.length,3,'Every claimed observation reaches its original finalizer');
  assert.equal(result.status,'receipt_read_unavailable');assert.equal(result.errors,0);assert.equal(result.readErrors,1);
  assert.equal(result.held,target==='lease'?3:1);assert.equal(result.delivered,target==='lease'?0:2);
  assert(!JSON.stringify(saved).includes('private'),'Cleanup errors and invalid origins are not provider receipts');
 }finally{
  // Late cleanup rejection remains handled after the recovery result returns.
  if(cleanup==='pending')rejectCleanup(Error('private late cleanup'));
  await flush();await pending;
 }
}
// A completely read provider response also keeps its original bytes if cleanup
// itself throws or rejects. The existing finalizer still decides delivery.
for(const cleanup of ['pending','rejected','synchronous']){
 const rawText=' {"object":"response","data":{"status":"delivered"}}\n';
 const response=new Response(rawText),getReader=response.body.getReader.bind(response.body);
 let cancelCount=0,rejectCleanup,saved;
 const cleanupWait=new Promise((_,reject)=>{rejectCleanup=reject;});
 response.body.getReader=()=>{
  const reader=getReader();reader.cancel=()=>{
   cancelCount++;
   if(cleanup==='synchronous')throw Error('private cleanup');
   return cleanup==='rejected'?Promise.reject(Error('private cleanup')):cleanupWait;
  };return reader;
 };
 let result,settled=false;
 const pending=recoverTextDeliveryReceipts(async(path,method,body)=>{
  if(path==='rpc/icash_claim_text_delivery_rechecks')return [claims[0]];
  assert.equal(path,'rpc/icash_finish_text_delivery_recheck');saved=body;return 'held';
 },env,async url=>url.endsWith('/numbers/leased')?Response.json({object:'response',data:{numbers:[{number:{e164:sender}}]}}):response)
 .then(value=>{result=value;settled=true;});
 try{
  await flush();await flush();assert.equal(settled,true,'Complete receipt cannot wait for cleanup');await pending;
  assert.equal(cancelCount,1);assert.equal(response.body.locked,false);
  assert.equal(saved.p_receipt.message.rawText,rawText,'Original response bytes remain unchanged');
  assert.deepEqual(saved.p_receipt.message.raw,JSON.parse(rawText));
  assert.equal(result.status,'checked');assert.equal(result.readErrors,0);assert.equal(result.errors,0);
  assert.equal(result.held,1);assert.equal(result.delivered,0,'Transport success never overrides the finalizer hold');
 }finally{
  if(cleanup==='pending')rejectCleanup(Error('private late cleanup'));
  await flush();await pending;
 }
}
console.log('PASS original text receipt recovery reports failed reads, preserves failed observations, and completes independent claims without replay.');
