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
 assert.equal(saved.length,3,'Every already-claimed row records its observation despite another failure');
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
console.log('PASS original text receipt recovery reports failed reads, preserves failed observations, and completes independent claims without replay.');
