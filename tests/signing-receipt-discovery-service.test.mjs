import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {z} from 'zod';
import {signatureRequestMessage} from '../lib/signing-invitation.ts';
import {originalContractProfile,originalContractFieldsForRole} from '../lib/original-contracts.ts';
import {normalizeDocuseal as normalize} from '../lib/docuseal-policy.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {SigningDeadlineReviewError,signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus} from '../lib/signing-policy.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {automationTick} from '../worker/runner.mjs';
const terms=dealTermsSchema.parse({seller:'Fixture seller',buyer:'Fixture principal',address:'Fixture only',legalDescription:'Fixture lot',state:'TX',priceCents:100000,priceSource:'seller_reported',earnestCents:0,closingDate:'2027-01-15'});
const recipients=[{id:'1',email:'seller@example.invalid',name:'Fixture seller',placeholder_name:'Seller'},{id:'2',email:'customer@example.invalid',name:'Fixture principal',placeholder_name:'Customer'}];
const envelope={id:'envelope',account_id:'account',deal_id:'deal',terms,kind:'purchase',terms_hash:signingTermsHash(terms),template_id:'template',provider_id:'123',state:'needs_review',test_mode:true,created_at:'2026-11-14T12:00:00Z',recipients};
const template={form_profile:'legacy',id:'template',provider:'docuseal',provider_template_id:'123',placeholder_names:['Seller','Customer'],field_map:Object.fromEntries(Object.keys(signingFields(terms,'purchase',false,'legacy')).map(k=>[k,k])),test_mode:true,rate_id:null,reviewed_until:'2027-02-01T00:00:00Z',max_legal_description_chars:2000,automated_signing_reviewed:true,customer_signature_field:'signature',customer_consent_field:'consent'};
const document=()=>({id:123,submitters_order:'preserved',completed_at:null,status:'pending',submitters:recipients.map((r,n)=>({id:n+1,submission_id:123,email:r.email,external_id:`envelope:${r.id}`,status:'awaiting',completed_at:null,metadata:{terms_hash:envelope.terms_hash},values:Object.entries(signingFields(terms,'purchase',false,'legacy')).map(([field,value])=>({field,value})),slug:'never-retain-secret'}))});
let raw=document(),records=[],requests=[],allowedReads=0,failAt=0,patchFailure=false,expireFailure=false,markerResult=true,pollClaim=true,observed=[];
const db=async(path,method,body)=>{
 records.push({path,method,body});
 if(path.startsWith('icash_deal_files'))return [{terms,stage:'draft'}];
 if(path.startsWith('icash_customer_identities'))return [{principal:'Fixture principal'}];
 if(path.startsWith('icash_signing_templates'))return [template];
 if(path==='rpc/icash_begin_signing')return {...envelope,state:'creating',provider_id:null};
 if(path.startsWith('icash_signing_envelopes')){if(method==='PATCH'&&body.provider_id&&patchFailure)throw Error('Uncertain provider ID save');return method==='PATCH'?[]:[envelope];}
 if(path==='rpc/icash_signing_action_allowed'){allowedReads++;if(allowedReads===failAt)throw Error('Transient cancellation-check read');return failAt!==-1||allowedReads===1;}
 if(path==='rpc/icash_note_signing_checkpoint_failure')return markerResult;
 if(path==='rpc/icash_claim_signing_poll')return pollClaim;
 if(path==='rpc/icash_record_signing_receipt'){observed.push(body);return envelope.state==='needs_review'?'needs_review':body.p_state;}
 throw Error('Forbidden fixture database call '+path);
};
const deps={signatureRequestMessage,originalContractProfile,originalContractFieldsForRole,normalize,z,db,dispatchReservedOperation:async(_i,send)=>send(),dispatchAttentionNotification:()=>{throw Error('Receipt must not send notifications');},dispatchCustomerUpdate:()=>{throw Error('Receipt must not send notifications');},SigningDeadlineReviewError,signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus,dealTermsSchema};
const {sendForSignatures,reconcileSigningReceipt}=await loadService('lib/signing-service.ts',deps);
const oldFetch=globalThis.fetch,oldNow=Date.now,oldEnv={DOCUSEAL_TEST_API_KEY:process.env.DOCUSEAL_TEST_API_KEY,DOCUSEAL_API_KEY:process.env.DOCUSEAL_API_KEY,DOCUSEAL_MODE:process.env.DOCUSEAL_MODE};
globalThis.fetch=async(url,options)=>{requests.push({url,method:options.method});if(options.method==='GET'){assert.equal(url,'https://api.docuseal.com/submissions/123');return Response.json(raw);}if(options.method==='PUT'&&expireFailure)throw Error('Fixture expire failure');return Response.json([{submission_id:123},{submission_id:123}]);};
Date.now=()=>Date.parse('2026-11-16T12:00:00Z');process.env.DOCUSEAL_TEST_API_KEY='fixture';process.env.DOCUSEAL_API_KEY='fixture';process.env.DOCUSEAL_MODE='test';
const reset=()=>{raw=document();records=[];requests=[];allowedReads=0;failAt=0;patchFailure=false;expireFailure=false;markerResult=true;observed=[];envelope.state='needs_review';pollClaim=true;};
const input={accountId:'account',userId:'user',customerEmail:'customer@example.invalid',dealId:'deal',kind:'purchase',signers:[{name:'Fixture seller',email:'seller@example.invalid'}]};
try{
 // A known failed original GET must return to its caller without waiting for
 // transport cleanup. It never records a receipt, signs or creates anything.
 const originalFixtureFetch=globalThis.fetch,flush=()=>new Promise(resolve=>setImmediate(resolve));
 for(const cleanup of ['pending','rejected','synchronous']){
  reset();let cancels=0,rejectCleanup,settled=false,error;
  const cleanupWait=new Promise((_,reject)=>{rejectCleanup=reject;});
  const response=new Response(new ReadableStream({
   start(controller){controller.enqueue(new Uint8Array(1));},
   cancel(){cancels++;return cleanup==='rejected'?Promise.reject(Error('private cleanup')):cleanupWait;},
  }),{status:503});
  if(cleanup==='synchronous')response.body.cancel=()=>{cancels++;throw Error('private cleanup');};
  globalThis.fetch=async(url,options)=>{requests.push({url,method:options.method});assert.equal(options.redirect,'error');return response;};
  const pending=reconcileSigningReceipt('account','envelope').then(()=>{settled=true;},failure=>{error=failure;settled=true;});
  try{
   await flush();await flush();assert.equal(settled,true,`${cleanup}: failed original poll cannot await cleanup`);await pending;
   assert.equal(error?.message,'Signing provider request failed. Do not resend until its status is checked.');
   assert.equal(cancels,1);assert.deepEqual(requests,[{url:'https://api.docuseal.com/submissions/123',method:'GET'}]);
   assert.equal(observed.length,0);assert.equal(envelope.state,'needs_review');
   assert.equal(records.filter(r=>r.path==='rpc/icash_claim_signing_poll').length,1);
   assert(!records.some(r=>r.method==='PATCH'||r.path==='rpc/icash_claim_auto_signature'),'No evidence or authority is fabricated from failure');
  }finally{
   if(cleanup==='pending')rejectCleanup(Error('private late cleanup'));
   await flush();await pending;globalThis.fetch=originalFixtureFetch;
  }
 }
 for(const terminal of ['pending','expired','declined','archived','unknown','future','completed']){
  reset();
  if(['expired','declined'].includes(terminal))raw.status=terminal;
  if(terminal==='archived')raw.archived_at='2026-11-15T12:00:00Z';
  if(terminal==='unknown')raw.status='new-provider-status';
  if(terminal==='future')raw.archived_at='2027-11-15T12:00:00Z';
  if(terminal==='completed'){raw.status='completed';raw.completed_at='2026-11-15T12:00:00Z';for(const s of raw.submitters){s.status='completed';s.completed_at='2026-11-15T12:00:00Z';}}
  assert.deepEqual(await reconcileSigningReceipt('account','envelope'),{status:'signing_receipt_checked',state:'needs_review'});
  assert.deepEqual(requests.map(r=>r.method),['GET']);
  assert.equal(observed[0].p_terminal,['expired','declined','archived'].includes(terminal));
  assert(!JSON.stringify(observed).includes('never-retain-secret'));
  assert.equal(records.filter(r=>r.path==='rpc/icash_record_signing_receipt').length,1);
 }
 for(const corrupt of ['id','external','hash','contact','order','field']){
  reset();if(corrupt==='id')raw.id=999;if(corrupt==='external')raw.submitters[0].external_id='other:1';if(corrupt==='hash')raw.submitters[0].metadata.terms_hash='wrong';if(corrupt==='contact')raw.submitters[0].email='other@example.invalid';if(corrupt==='order')raw.submitters_order='random';
  if(corrupt==='field'){raw.submitters[0].status='completed';raw.submitters[0].completed_at='2026-11-15T12:00:00Z';raw.submitters[0].values.find(v=>v.field==='priceCents').value='999999';}
  await assert.rejects(()=>reconcileSigningReceipt('account','envelope'));assert.equal(observed.length,0);assert.deepEqual(requests.map(r=>r.method),['GET']);
 }
 for(const testMode of [false,true])for(const chronology of ['before-original','before-final-signer']){
  reset();envelope.test_mode=testMode;raw.status='completed';raw.completed_at=chronology==='before-original'?'2000-01-01T00:00:00Z':'2026-11-15T11:00:00Z';
  for(const s of raw.submitters){s.status='completed';s.completed_at=chronology==='before-original'?'2000-01-01T00:00:00Z':'2026-11-15T12:00:00Z';}
  await reconcileSigningReceipt('account','envelope');assert.equal(observed[0].p_state,'needs_review');assert.equal(observed[0].p_evidence.status,'Unknown');assert.equal(observed[0].p_terminal,false);assert.deepEqual(requests.map(r=>r.method),['GET']);
 }
 envelope.test_mode=true;
 for(const terminal of ['completed','test_completed','cancellation_pending','cancelled']){reset();envelope.state=terminal;await reconcileSigningReceipt('account','envelope');assert.equal(requests.length,0);assert.equal(observed.length,0);}
 reset();pollClaim=false;assert.equal((await reconcileSigningReceipt('account','envelope')).status,'signing_receipt_waiting');assert.equal(requests.length,0);
 for(const at of [2,3]){reset();failAt=at;await assert.rejects(()=>sendForSignatures(input),/Transient/);assert.deepEqual(requests.map(r=>r.method),['POST']);const markers=records.filter(r=>r.path==='rpc/icash_note_signing_checkpoint_failure');assert.equal(markers.length,1);assert.equal(markers[0].body.p_provider,'123');assert.deepEqual(markers[0].body.p_template,template);assert(!records.some(r=>r.method==='PATCH'&&r.body.state==='needs_review'));}
 for(const failure of ['before-create','uncertain-id-save','observed-cancellation','marker-unavailable']){
  reset();if(failure==='before-create')failAt=1;if(failure==='uncertain-id-save')patchFailure=true;if(failure==='observed-cancellation'){failAt=-1;expireFailure=true;}if(failure==='marker-unavailable'){failAt=2;markerResult=false;}
  await assert.rejects(()=>sendForSignatures(input));assert.equal(records.filter(r=>r.path==='rpc/icash_note_signing_checkpoint_failure').length,failure==='marker-unavailable'?1:0);assert(records.some(r=>r.method==='PATCH'&&r.body.state==='needs_review'));assert(requests.filter(r=>r.method==='POST').length<=1);
 }
 reset();
 const token='00000000-0000-4000-8000-000000000001'.repeat(2);let consumed=false,finish;
 const routeDeps={reconcileSigningReceipt,refreshSigning:()=>{throw Error('Expanded receipts must never enter auto-signing');},automationWorkReady:()=>true,newLiveWorkKinds:new Set(),NextResponse:{json:Response.json},db:async(path,_method,body)=>{if(path==='rpc/icash_consume_automation'){if(consumed)return null;consumed=true;return {id:'ticket',accountId:'account',kind:'signing_receipt',signingId:'envelope'};}if(path==='rpc/icash_finish_automation'){finish=body;return null;}throw Error(path);}};
 const {POST}=await loadService('app/api/internal/automation/route.ts',routeDeps);
 assert.equal(await automationTick(async()=>({token}),async(_url,options)=>POST(new Request('https://fixture.invalid/api/internal/automation',options)),'recovery'),true);
 assert.equal(finish.p_success,true);assert.equal(finish.p_outcome,'signing_receipt_checked');assert.equal(envelope.state,'needs_review');assert.deepEqual(requests.map(r=>r.method),['GET']);
 assert.equal((await POST(new Request('https://fixture.invalid',{headers:{Authorization:'Bearer '+token}}))).status,401);
 // Execute the deployed predecessor route, not a model of its branching.
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/signing-receipt-previous-route.json',import.meta.url),'utf8'));
 assert.equal(createHash('sha256').update(fixture.source).digest('hex'),fixture.sha256);
 const predecessor=fixture.source;
 const code=ts.transpileModule(predecessor,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 globalThis.__oldSigningReceiptRoute=routeDeps;
 const old=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(routeDeps).join(',')+'}=globalThis.__oldSigningReceiptRoute;\n'+code).toString('base64'));
 consumed=false;requests=[];await old.POST(new Request('https://fixture.invalid',{headers:{Authorization:'Bearer '+token}}));assert.equal(finish.p_success,false);assert.equal(finish.p_outcome,'held');assert.equal(requests.length,0,'old app holds the new receipt capability without provider I/O');
 console.log('Actual signing service and old/new worker routes: exact original GET-only discovery, retained historical holds, provider failures, saved-ID checkpoint classification and one-use rolling capabilities pass.');
}finally{globalThis.fetch=oldFetch;Date.now=oldNow;for(const [key,val]of Object.entries(oldEnv))if(val===undefined)delete process.env[key];else process.env[key]=val;delete globalThis.__oldSigningReceiptRoute;}
