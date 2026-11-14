import assert from 'node:assert/strict';
import {test} from 'node:test';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {normalizeDocuseal as normalize} from '../lib/docuseal-policy.ts';
import {verifiedSigningStatus} from '../lib/signing-policy.ts';

const oldKey=process.env.DOCUSEAL_TEST_API_KEY;
process.env.DOCUSEAL_TEST_API_KEY='fixture-no-network';
const recipients=[{id:'1',email:'seller@example.invalid'},{id:'2',email:'buyer@example.invalid'}];
const envelope={id:'envelope',account_id:'account',provider_id:'123',terms_hash:'fixture-hash',state:'test_completed',test_mode:true,recipients};
let reads,cancelled,pdfResponse,requests;
const service=await loadService('lib/signing-service.ts',{z,normalize,verifiedSigningStatus,
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
}finally{if(oldKey===undefined)delete process.env.DOCUSEAL_TEST_API_KEY;else process.env.DOCUSEAL_TEST_API_KEY=oldKey;}
