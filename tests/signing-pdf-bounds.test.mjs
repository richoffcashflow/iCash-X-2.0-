import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {normalizeDocuseal as normalize} from '../lib/docuseal-policy.ts';
import {verifiedSigningStatus} from '../lib/signing-policy.ts';

const oldKey=process.env.DOCUSEAL_TEST_API_KEY;
process.env.DOCUSEAL_TEST_API_KEY='fixture-no-network';
const recipients=[{id:'1',email:'seller@example.invalid'},{id:'2',email:'buyer@example.invalid'}];
const envelope={id:'envelope',account_id:'account',provider_id:'123',terms_hash:'fixture-hash',state:'test_completed',test_mode:true,recipients};
let reads,cancelled,pdfResponse,requests;
const service=await loadService('lib/signing-service.ts',{z,normalize,verifiedSigningStatus,isDeepStrictEqual,
 db:async path=>{assert(path.includes('account_id=eq.account'));return [envelope];},
 fetch:async(url,options)=>{
  requests.push(String(url));assert.equal(options.redirect,'error');
  if(String(url).includes('/documents?'))return Response.json([{url:'https://docuseal.com/file/fixture.pdf'}]);
  if(String(url).includes('api.docuseal.com'))return Response.json({id:123,submitters_order:'preserved',completed_at:'2026-01-01T00:00:00Z',submitters:recipients.map((r,i)=>({id:i+1,submission_id:123,email:r.email,external_id:`envelope:${r.id}`,status:'completed',completed_at:'2026-01-01T00:00:00Z',metadata:{terms_hash:'fixture-hash'}}))});
  assert.equal(String(url),'https://docuseal.com/file/fixture.pdf');return pdfResponse;
 }});
function stream(chunks,headers={}){
 reads=0;cancelled=0;requests=[];
 pdfResponse=new Response(new ReadableStream({pull(controller){if(reads>=chunks.length){controller.close();return;}controller.enqueue(chunks[reads++]);},cancel(){cancelled++;}},{highWaterMark:0}),{headers:{'Content-Type':'application/pdf',...headers}});
}
try{
 await test('declared oversized signing PDF is rejected before body reads',async()=>{
  stream([new Uint8Array(1)],{'Content-Length':String(21*1024*1024)});
  await assert.rejects(service.completedSigningPdf('account','envelope'),/large/);
  assert.equal(reads,0);assert.equal(cancelled,1);assert.equal(requests.length,3);
 });
 await test('chunked or misleading PDF size cannot allocate an unbounded body',async()=>{
  for(const headers of [{},{'Content-Length':'1'}]){
   stream(Array.from({length:24},()=>new Uint8Array(1024*1024)),headers);
   await assert.rejects(service.completedSigningPdf('account','envelope'),/large/);
   assert.equal(reads,21);assert.equal(cancelled,1);assert.equal(pdfResponse.body.locked,false);
  }
 });
 await test('valid PDF bytes are preserved exactly without further fetches',async()=>{
  const chunks=[new TextEncoder().encode('%PDF-1.7\n'),new Uint8Array([0,128,255])];stream(chunks);
  const bytes=await service.completedSigningPdf('account','envelope');
  assert(bytes instanceof ArrayBuffer);assert.deepEqual(Buffer.from(bytes),Buffer.concat(chunks));
  assert.equal(requests.length,3);assert.equal(pdfResponse.body.locked,false);
 });
 await test('empty successful PDF responses cannot become executed attachments',async()=>{
  for(const headers of [{},{'Content-Length':'0'}]){
   stream([],headers);
   await assert.rejects(service.completedSigningPdf('account','envelope'),/PDF is empty/);
   assert.equal(requests.length,3);assert.equal(pdfResponse.body.locked,false);
  }
 });
 await test('loaded title PDF source must match before any provider read',async()=>{
  Object.assign(envelope,{deal_id:'deal',kind:'purchase',terms:{address:'Fixture'},template_id:'template',created_at:'2026-01-01T00:00:00Z'});
  const expected={id:envelope.id,accountId:envelope.account_id,dealId:envelope.deal_id,kind:envelope.kind,state:envelope.state,testMode:envelope.test_mode,
   providerId:envelope.provider_id,terms:envelope.terms,termsHash:envelope.terms_hash,templateId:envelope.template_id,recipients:envelope.recipients,createdAt:'2025-12-31T18:00:00-06:00'};
  for(const changed of [{providerId:'456'},{termsHash:'changed'},{recipients:[]},{state:'completed'},{terms:{address:'Different'}},{createdAt:'bad'}]){
   stream([new Uint8Array([1])]);await assert.rejects(service.completedSigningPdf('account','envelope',false,{...expected,...changed}),/changed before PDF/);assert.equal(requests.length,0);
  }
  stream([new Uint8Array([1,2,3])]);assert.deepEqual(new Uint8Array(await service.completedSigningPdf('account','envelope',false,expected)),new Uint8Array([1,2,3]));assert.equal(requests.length,3);
 });
 await test('PDF cleanup cannot block known rejection or change complete original bytes',async()=>{
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  for(const result of ['bad_type','declared_size','chunked_size','complete'])for(const cleanup of ['pending','rejected','synchronous']){
   requests=[];let cancels=0,rejectCleanup,settled=false,error,value;
   const bytes=new Uint8Array([37,80,68,70,45,0,128,255]),cleanupWait=new Promise((_,reject)=>{rejectCleanup=reject;});
   pdfResponse=result==='complete'?new Response(bytes,{headers:{'Content-Type':'application/pdf'}}):new Response(new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array(result==='chunked_size'?20*1024*1024+1:1));},
    cancel(){cancels++;return cleanup==='rejected'?Promise.reject(Error('private cleanup')):cleanupWait;},
   }),{headers:{'Content-Type':result==='bad_type'?'text/html':'application/pdf',...(result==='declared_size'?{'Content-Length':String(21*1024*1024)}:{})}});
   if(result==='complete'||cleanup==='synchronous'){
    const cancel=()=>{cancels++;if(cleanup==='synchronous')throw Error('private cleanup');return cleanup==='rejected'?Promise.reject(Error('private cleanup')):cleanupWait;};
    if(['bad_type','declared_size'].includes(result))pdfResponse.body.cancel=cancel;
    else{const getReader=pdfResponse.body.getReader.bind(pdfResponse.body);pdfResponse.body.getReader=()=>{const reader=getReader();reader.cancel=cancel;return reader;};}
   }
   const pending=service.completedSigningPdf('account','envelope').then(output=>{value=output;settled=true;},failure=>{error=failure;settled=true;});
   try{
    await flush();await flush();assert.equal(settled,true,`${result}/${cleanup}: PDF outcome cannot await cleanup`);await pending;
    assert.equal(cancels,1);assert.equal(pdfResponse.body.locked,false);
    assert.deepEqual(requests,['https://api.docuseal.com/submissions/123','https://api.docuseal.com/submissions/123/documents?merge=true','https://docuseal.com/file/fixture.pdf'],'Read only the original submission, documents and PDF once');
    if(result==='complete'){assert.equal(error,undefined);assert.deepEqual(new Uint8Array(value),bytes);}
    else{assert.equal(value,undefined);assert.equal(error?.message,result==='bad_type'?'Signed PDF is not ready.':'PDF too large.');}
   }finally{
    if(cleanup==='pending')rejectCleanup(Error('private late cleanup'));
    await flush();await pending;
   }
  }
 });
}finally{if(oldKey===undefined)delete process.env.DOCUSEAL_TEST_API_KEY;else process.env.DOCUSEAL_TEST_API_KEY=oldKey;}
