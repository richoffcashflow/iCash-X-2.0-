import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {loadService,databaseAdapter} from './helpers/simulated-journey-services.mjs';
import {normalizeDocuseal as normalize} from '../lib/docuseal-policy.ts';
import {verifiedSigningStatus} from '../lib/signing-policy.ts';
import {prepareTitleCopyDelivery} from '../lib/title-copy-delivery.ts';
import {titleEmailAddress} from '../lib/title-inbound-policy.ts';
import {titleConfirmationInstructions,titleConfirmationInstructionsFor} from '../lib/title-confirmation-instructions.ts';
import {closingPayoutNote} from '../lib/closing-setup.ts';
import {installTitleCopyFixture,installTitleCopyMigration,titleCopyCase} from './fixtures/title-copy-fixture.mjs';
import {installTitleDeadlineSeed} from './fixtures/title-task-delivery-fixture.mjs';

// Provider and financial boundaries are offline sentinels. The actual title
// claim, PDF reader, service and task mutations execute over the real SQL.
const pg=new PGlite(),env={...process.env};
const row=async(sql,args=[])=>(await pg.query(sql,args)).rows[0];
let current,transient=false,edit=null,afterPdf=null,beforeLegacyFollowup=null,beforePreparationReview=null,failPdf=false,failEmail=false,loseFinishAck=false,emptyPdf=false,gets=0,posts=0,claims=0,attachment;
const adapter=databaseAdapter(pg);
const db=async(path,method,args)=>{
 if(method==='POST'&&path==='rpc/icash_review_title_task_preparation'&&beforePreparationReview){const hook=beforePreparationReview;beforePreparationReview=null;await hook();}
 if(method==='POST'&&path==='rpc/icash_claim_title_update'){
  claims++;
  const values=[args.p_account,args.p_task,args.p_payload];if(Object.hasOwn(args,'p_snapshot'))values.push(args.p_snapshot);
  return (await row(`select public.icash_claim_title_update(${values.map((_,i)=>'$'+(i+1)).join(',')}) value`,values)).value;
 }
 if(method==='POST'&&path==='rpc/icash_claim_title_followup'){
  if(!Object.hasOwn(args,'p_delivery_version')&&beforeLegacyFollowup){const hook=beforeLegacyFollowup;beforeLegacyFollowup=null;await hook();}
  const values=[args.p_account,args.p_task];if(Object.hasOwn(args,'p_delivery_version'))values.push(args.p_delivery_version);
  return (await row(`select public.icash_claim_title_followup(${values.map((_,i)=>'$'+(i+1)).join(',')}) value`,values)).value;
 }
 if(method==='POST'&&path==='rpc/icash_finish_title_task_delivery'&&loseFinishAck){
  loseFinishAck=false;await adapter.db(path,method,args);throw Error('Fixture original receipt acknowledgement lost');
 }
 if(!method&&path.startsWith('icash_signing_envelopes?')&&transient){
  await pg.query("update public.icash_signing_envelopes set provider_id='202' where id=$1",[current.assignment]);
  const result=await adapter.db(path,method,args);
  await pg.query("update public.icash_signing_envelopes set provider_id='102' where id=$1",[current.assignment]);
  return result;
 }
 return adapter.db(path,method,args);
};
const signing=await loadService('lib/signing-service.ts',{db,z,normalize,verifiedSigningStatus,isDeepStrictEqual,fetch:async url=>{
 gets++;if(failPdf)throw Error('Fixture temporary PDF provider unavailable');const id=transient?202:102;
 if(String(url).includes('/documents?'))return Response.json([{url:`https://docuseal.com/file/${id}.pdf`}]);
 if(String(url).includes('api.docuseal.com')){
  const completed=new Date(Date.now()-2*60*60*1000).toISOString();
  return Response.json({id,submitters_order:'preserved',completed_at:completed,submitters:[1,2].map(i=>({id:i,submission_id:id,email:`signer${i}@example.invalid`,external_id:`${current.assignment}:${i}`,status:'completed',completed_at:completed,metadata:{terms_hash:'fixture-terms'}}))});
 }
 if(afterPdf)await afterPdf();
 return new Response(emptyPdf?'':'%PDF-'+id,{headers:{'Content-Type':'application/pdf'}});
}});
const deps={db,completedSigningPdf:signing.completedSigningPdf,prepareTitleCopyDelivery,titleEmailAddress,titleConfirmationInstructionsFor,closingPayoutNote,isDeepStrictEqual,fetch:async(url,options)=>{
 assert.equal(url,'https://api.resend.com/emails');assert.equal(options.method,'POST');posts++;
 const body=JSON.parse(options.body);attachment=body.attachments?.[0]?.content;
 assert.equal((await row('select email_state from public.icash_title_tasks where id=$1',[current.task.id])).email_state,'dispatching');
 if(edit)await edit();
 if(failEmail)throw Error('Fixture original email outcome unknown');
 return Response.json({id:'fixture-title-original-'+posts});
}};
async function assignment(){
 current=await titleCopyCase(pg);
 await pg.query('update public.icash_signing_envelopes set recipients=$2 where id=$1',[current.assignment,[1,2].map(i=>({id:String(i),email:`signer${i}@example.invalid`}))]);
 current.task=await row("insert into public.icash_title_tasks(account_id,deal_id,request_id,source_key,kind,label,state,email_state,payload) values($1,$2,$3,$4,'document_update','Send signed assignment','scheduled','issued',$5) returning *",[current.account,current.deal,current.request,'fixture-assignment-'+randomUUID(),{type:'assignment',envelopeId:current.assignment}]);
 return current;
}
try{
 await installTitleCopyFixture(pg);await installTitleCopyMigration(pg);await installTitleDeadlineSeed(pg);
 const followupPredecessor=JSON.parse(readFileSync('tests/fixtures/title-task-delivery-predecessors.json','utf8')).find(x=>x.signature==='icash_claim_title_followup(uuid,uuid)');
 await pg.exec(followupPredecessor.definition??followupPredecessor.source);
 await pg.exec('revoke all on function public.icash_claim_title_followup(uuid,uuid) from public,anon,authenticated;grant execute on function public.icash_claim_title_followup(uuid,uuid) to service_role;');
 Object.assign(process.env,{DOCUSEAL_API_KEY:'fictional',ICASH_LIVE_WORK_READY:'true',RESEND_API_KEY:'fictional',RESEND_RECEIVING_WEBHOOK_SECRET:'fictional',ICASH_TITLE_FROM_EMAIL:'title@example.invalid',ICASH_TITLE_REPLY_EMAIL:'reply@example.invalid'});
 // Frozen exact b938c8e5 service body keeps the old failures reproducible after
 // the corrected service changes. These assertions are evidence of the defect.
 // Discard those historical originals before the prospective empty-table guard;
 // the migration must never synthesize admission evidence for old attempts.
 await pg.exec('begin');
 const legacy=await loadService('tests/fixtures/title-update-before-original-source.ts.txt',deps);
 await assignment();transient=true;
 assert.equal((await legacy.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_sent');
 assert.equal(Buffer.from(attachment,'base64').toString(),'%PDF-202','Old path sends the transient replacement PDF after the original row is restored');
 assert.equal((await row('select provider_id from public.icash_signing_envelopes where id=$1',[current.assignment])).provider_id,'102');
 assert.equal(gets,3);assert.equal(posts,1);
 await assignment();transient=false;
 edit=()=>pg.query("update public.icash_title_tasks set label='Manually added evidence',payload=payload||'{\"manualReview\":true}'::jsonb where id=$1",[current.task.id]);
 assert.equal((await legacy.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_sent');
 const changed=await row('select state,label,payload,email_provider_id from public.icash_title_tasks where id=$1',[current.task.id]);
 assert.equal(changed.state,'done','Old path completes business work edited after the original email claim');
 assert.equal(changed.label,'Manually added evidence');assert.equal(changed.payload.manualReview,true);
 await assignment();
 const payout={payeeName:'Fixture LLC',payeeType:'company',method:'check_mail',mailingAddress:'100 Fixture Lane, Dallas TX 75201'};
 await pg.query('insert into public.icash_closing_setup(account_id,deal_id,payout) values($1,$2,$3)',[current.account,current.deal,{...payout,detailsSharedWithTitle:false}]);
 await pg.query('update public.icash_title_tasks set payload=$2 where id=$1',[current.task.id,{type:'payout',payout}]);
 const payoutGets=gets;
 assert.equal((await legacy.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_sent');
 assert.equal(gets,payoutGets);assert.equal((await row('select state from public.icash_title_tasks where id=$1',[current.task.id])).state,'done','Old payout receipt also completes edited work');
 const legacyFollowup=await loadService('tests/fixtures/title-followup-before-original-source.ts.txt',{...deps,titleConfirmationInstructions,dispatchTitleUpdate:()=>{throw Error('Unexpected document update');}});
 current=await titleCopyCase(pg);
 current.task=await row("update public.icash_title_tasks set email_state='issued',due_date=(now() at time zone 'America/Chicago')::date where request_id=$1 and kind='follow_up' returning *",[current.request]);
 assert.equal((await legacyFollowup.dispatchTitleFollowup(current.account,current.task.id)).status,'title_followup_sent');
 assert.equal((await row('select state from public.icash_title_tasks where id=$1',[current.task.id])).state,'done','Old reminder receipt also completes edited work');
 console.log('REPRODUCED actual legacy service→SQL/PDF: transient replacement PDF was sent and edited assignment, payout and follow-up title work was marked done. Offline fixtures only.');
 await pg.exec('rollback');

 await pg.exec('begin;'+readFileSync('config/title-task-delivery-source.sql','utf8')+'commit;');
 const fixed=await loadService('lib/title-update-service.ts',deps);
 const fixedFollowup=await loadService('lib/title-followup-service.ts',{...deps,titleConfirmationInstructions,dispatchTitleUpdate:fixed.dispatchTitleUpdate});
 const operationCount=()=>row('select count(*)::int n from public.icash_operation_spend where operation_key=$1',['title-followup:'+current.task.id]).then(r=>r.n);
 const receipt=()=>row('select * from icash_title_task_delivery_private.receipts where task_id=$1',[current.task.id]);
 const finish=provider=>db('rpc/icash_finish_title_task_delivery','POST',{p_account:current.account,p_task:current.task.id,p_provider:provider});

 // Independent frozen 609955b0 service reproduces the introduced endless retry:
 // a deterministic bad original provider ID never became a durable review.
 await pg.exec('begin');
 const beforePreparation=await loadService('tests/fixtures/title-update-before-preparation-review.ts.txt',deps);
 await assignment();edit=null;transient=false;
 await pg.query("update public.icash_signing_envelopes set provider_id='invalid-provider-id' where id=$1",[current.assignment]);
 const invalidGets=gets,invalidPosts=posts;
 for(let attempt=0;attempt<2;attempt++){
  if(attempt)await pg.query("update public.icash_title_tasks set email_state='issued' where id=$1",[current.task.id]);
  assert.equal((await beforePreparation.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_spending_held');
  assert.deepEqual(await row('select state,email_state from public.icash_title_tasks where id=$1',[current.task.id]),{state:'scheduled',email_state:'waiting'});
 }
 assert.equal(gets,invalidGets);assert.equal(posts,invalidPosts);await pg.exec('rollback');
 console.log('REPRODUCED pre-review correction: deterministic invalid original provider ID repeated six-hour retries without durable review.');

 const preparationReview=()=>row('select * from icash_title_task_delivery_private.preparation_reviews where task_id=$1',[current.task.id]);
 for(const [reason,mutate] of [
  ['invalid_provider_id',()=>pg.query("update public.icash_signing_envelopes set provider_id='invalid-provider-id' where id=$1",[current.assignment])],
  ['invalid_assignment_reference',()=>pg.query("update public.icash_title_tasks set payload='{\"type\":\"assignment\",\"envelopeId\":\"malformed\"}' where id=$1",[current.task.id])],
  ['invalid_payout',()=>pg.query("update public.icash_title_tasks set payload='{\"type\":\"payout\",\"payout\":{\"payeeName\":\"Fixture\",\"accountNumber\":\"123456789\"}}' where id=$1",[current.task.id])],
  ['unsupported_update',()=>pg.query("update public.icash_title_tasks set payload='{\"type\":\"unsupported\"}' where id=$1",[current.task.id])],
  ['unsupported_update',()=>pg.query("update public.icash_title_tasks set payload='null'::jsonb where id=$1",[current.task.id])],
 ]){
  await assignment();await mutate();const reads=gets,sends=posts;
  assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_needs_reconciliation',reason);
  assert.deepEqual(await row('select state,email_state from public.icash_title_tasks where id=$1',[current.task.id]),{state:'needs_review',email_state:'needs_review'});
  assert.equal((await preparationReview()).reason,reason);assert.equal(await operationCount(),0);assert.equal(gets,reads);assert.equal(posts,sends);
  assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_held');
  await assert.rejects(pg.query('delete from icash_title_task_delivery_private.preparation_reviews where task_id=$1',[current.task.id]),/immutable/i);
 }
 // A stale failure cannot review an edited task, a repaired document or a
 // current worker's admitted send. Compare the complete source under locks.
 for(const change of ['task','document','admitted']){
  await assignment();await pg.query("update public.icash_signing_envelopes set provider_id='invalid-provider-id' where id=$1",[current.assignment]);
  beforePreparationReview=async()=>{
   if(change==='task')await pg.query("update public.icash_title_tasks set label='Manually corrected work' where id=$1",[current.task.id]);
   else await pg.query("update public.icash_signing_envelopes set provider_id='102' where id=$1",[current.assignment]);
   if(change==='admitted'){
    const source=await db('rpc/icash_title_task_delivery_snapshot','POST',{p_account:current.account,p_task:current.task.id});
    assert(await db('rpc/icash_claim_title_update','POST',{p_account:current.account,p_task:current.task.id,p_payload:current.task.payload,p_snapshot:source}));
   }
  };
  assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_held');
  assert.equal(await preparationReview(),undefined);assert.equal((await row('select state from public.icash_title_tasks where id=$1',[current.task.id])).state,'scheduled');
  assert.equal((await row('select email_state from public.icash_title_tasks where id=$1',[current.task.id])).email_state,change==='admitted'?'dispatching':'issued');
 }
 await assignment();failPdf=true;const transientPosts=posts;
 assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_spending_held');
 assert.deepEqual(await row('select state,email_state from public.icash_title_tasks where id=$1',[current.task.id]),{state:'scheduled',email_state:'waiting'});
 assert.equal(await preparationReview(),undefined);assert.equal(await operationCount(),0);assert.equal(posts,transientPosts);
 failPdf=false;await pg.query("update public.icash_title_tasks set email_state='issued' where id=$1",[current.task.id]);
 assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_sent');assert.equal(posts,transientPosts+1);
 await assignment();delete process.env.DOCUSEAL_API_KEY;
 assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_configuration_required');
 assert.equal(await preparationReview(),undefined);assert.equal(await operationCount(),0);process.env.DOCUSEAL_API_KEY='fictional';

 // Rollback workers retain their exact old service bodies. An old overload
 // cannot gain authority to send or run its later direct completion PATCHes.
 await assignment();edit=null;transient=false;
 {
  const before=posts;
  assert.equal((await legacy.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_held');
  assert.equal(posts,before);assert.equal(await operationCount(),0);
  assert.deepEqual(await row('select state,email_state,email_provider_id from public.icash_title_tasks where id=$1',[current.task.id]),{state:'scheduled',email_state:'waiting',email_provider_id:null});
  assert.equal(await receipt(),undefined);
 }
 current=await titleCopyCase(pg);current.task=await row("update public.icash_title_tasks set email_state='issued',due_date=(now() at time zone 'America/Chicago')::date where request_id=$1 and kind='follow_up' returning *",[current.request]);
 {
  const before=posts;
  assert.equal((await legacyFollowup.dispatchTitleFollowup(current.account,current.task.id)).status,'title_followup_held');
  assert.equal(posts,before);assert.equal(await operationCount(),0);
  assert.deepEqual(await row('select state,email_state,email_provider_id from public.icash_title_tasks where id=$1',[current.task.id]),{state:'scheduled',email_state:'waiting',email_provider_id:null});
 }
 await assignment();
 {
  const before=posts,source=await db('rpc/icash_title_task_delivery_snapshot','POST',{p_account:current.account,p_task:current.task.id});
  afterPdf=async()=>{
   assert(await db('rpc/icash_claim_title_update','POST',{p_account:current.account,p_task:current.task.id,p_payload:current.task.payload,p_snapshot:source}));
   await pg.query("update public.icash_title_tasks set label='Edited while the current worker owns delivery' where id=$1",[current.task.id]);
  };
  assert.equal((await legacy.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_held');
  afterPdf=null;
  assert.equal(posts,before,'Old assignment worker cannot send after the current worker claimed during its PDF read');
  assert.equal(await operationCount(),1);
  assert.deepEqual(await row('select state,email_state,label,email_provider_id from public.icash_title_tasks where id=$1',[current.task.id]),{state:'scheduled',email_state:'dispatching',label:'Edited while the current worker owns delivery',email_provider_id:null});
  assert.equal((await row('select source from icash_title_task_delivery_private.admissions where task_id=$1',[current.task.id])).source.task.label,source.task.label,'The current original admission survives the stale worker');
  assert.equal(await receipt(),undefined,'The old worker cannot fabricate the current owner’s receipt');
 }
 current=await titleCopyCase(pg);current.task=await row("update public.icash_title_tasks set email_state='issued',due_date=(now() at time zone 'America/Chicago')::date where request_id=$1 and kind='follow_up' returning *",[current.request]);
 {
  const before=posts;
  beforeLegacyFollowup=async()=>{
   assert(await db('rpc/icash_claim_title_followup','POST',{p_account:current.account,p_task:current.task.id,p_delivery_version:'title-task-delivery-v1'}));
   await pg.query("update public.icash_title_tasks set label='Current reminder has additional work' where id=$1",[current.task.id]);
  };
  assert.equal((await legacyFollowup.dispatchTitleFollowup(current.account,current.task.id)).status,'title_followup_held');
  assert.equal(posts,before);assert.equal(await operationCount(),1);
  assert.deepEqual(await row('select state,email_state,label,email_provider_id from public.icash_title_tasks where id=$1',[current.task.id]),{state:'scheduled',email_state:'dispatching',label:'Current reminder has additional work',email_provider_id:null});
  assert.equal(await receipt(),undefined);
 }

 await assignment();edit=null;transient=true;
 let beforeGets=gets,beforePosts=posts;
 assert.notEqual((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_sent');
 assert.equal(gets,beforeGets,'Transient replacement is rejected before any provider read');
 assert.equal(posts,beforePosts);assert.equal(await operationCount(),0);
 transient=false;
 for(const mutation of [
  ()=>pg.query("update public.icash_title_tasks set label='Changed before claim' where id=$1",[current.task.id]),
  ()=>pg.query("update public.icash_signing_envelopes set provider_id='202' where id=$1",[current.assignment]),
  ()=>pg.query('update public.icash_accounts set bot_paused=true where id=$1',[current.account]),
 ]){
  await assignment();afterPdf=mutation;beforePosts=posts;
  assert.notEqual((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_sent');
  assert.equal(posts,beforePosts,'A changed final source/control prevents sending');assert.equal(await operationCount(),0,'Failed admission leaves no reservation');
 }
 afterPdf=null;
 await assignment();beforePosts=posts;
 assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_sent');
 assert.equal(posts,beforePosts+1);assert.equal(Buffer.from(attachment,'base64').toString(),'%PDF-102');
 assert.equal((await receipt()).provider_id,'fixture-title-original-'+posts);
 assert.equal((await row('select state from public.icash_title_tasks where id=$1',[current.task.id])).state,'done');
 const originalProvider='fixture-title-original-'+posts;
 assert.equal(await finish(originalProvider),true);assert.equal(await finish('different-provider'),false);
 await pg.query("update public.icash_title_tasks set state='scheduled',label='Later work' where id=$1",[current.task.id]);
 assert.equal(await finish(originalProvider),true);
 assert.equal((await row('select state from public.icash_title_tasks where id=$1',[current.task.id])).state,'scheduled','Duplicate original receipt never completes later edited work');
 assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_held');assert.equal(posts,beforePosts+1);

 const otherRequest=(await titleCopyCase(pg)).request;
 for(const mutate of [
  ()=>pg.query("update public.icash_title_tasks set label='Manual added evidence',payload=payload||'{\"manualReview\":true}'::jsonb where id=$1",[current.task.id]),
  ()=>pg.query('update public.icash_title_tasks set request_id=$2 where id=$1',[current.task.id,otherRequest]),
  ()=>pg.query("update public.icash_title_requests set recipient='new-closer@example.invalid' where id=$1",[current.request]),
  ()=>pg.query("update public.icash_signing_envelopes set terms=terms||'{\"changedPrice\":true}'::jsonb where id=$1",[current.assignment]),
 ]){
  await assignment();edit=mutate;beforePosts=posts;
  assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_sent','Known original delivery is journaled');
  assert.equal((await receipt()).provider_id,'fixture-title-original-'+posts);
  const changed=await row('select state,email_state from public.icash_title_tasks where id=$1',[current.task.id]);
  assert.equal(changed.state,'scheduled','Changed business work remains open');
  assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_held');assert.equal(posts,beforePosts+1);
 }
 await assignment();edit=null;
 const snapshot=await db('rpc/icash_title_task_delivery_snapshot','POST',{p_account:current.account,p_task:current.task.id});
 assert.equal(snapshot.version,'title-task-delivery-v1');
 assert.equal(await db('rpc/icash_claim_title_update','POST',{p_account:current.account,p_task:current.task.id,p_payload:current.task.payload}),null,'Old worker has no snapshot authority');
 for(const invalid of [null,{}, {...snapshot,version:'unknown'},{...snapshot,task:{...snapshot.task,label:'changed'}}]){
  assert.equal(await db('rpc/icash_claim_title_update','POST',{p_account:current.account,p_task:current.task.id,p_payload:current.task.payload,p_snapshot:invalid}),null);
 }
 assert.equal(await operationCount(),0);
 assert.equal(await db('rpc/icash_finish_title_task_delivery','POST',{p_account:randomUUID(),p_task:current.task.id,p_provider:'wrong-account'}),false);

 await assignment();
 await pg.query('insert into public.icash_closing_setup(account_id,deal_id,payout) values($1,$2,$3)',[current.account,current.deal,{...payout,detailsSharedWithTitle:false}]);
 await pg.query('update public.icash_title_tasks set payload=$2 where id=$1',[current.task.id,{type:'payout',payout}]);
 edit=()=>pg.query("update public.icash_title_tasks set label='New payout evidence' where id=$1",[current.task.id]);
 beforeGets=gets;
 assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_sent');
 assert.equal(gets,beforeGets);assert.equal((await row('select state from public.icash_title_tasks where id=$1',[current.task.id])).state,'scheduled');assert(await receipt());
 current=await titleCopyCase(pg);current.task=await row("update public.icash_title_tasks set email_state='issued',due_date=(now() at time zone 'America/Chicago')::date where request_id=$1 and kind='follow_up' returning *",[current.request]);
 edit=()=>pg.query("update public.icash_title_tasks set label='New title reminder work' where id=$1",[current.task.id]);
 assert.equal((await fixedFollowup.dispatchTitleFollowup(current.account,current.task.id)).status,'title_followup_sent');
 assert.equal((await row('select state from public.icash_title_tasks where id=$1',[current.task.id])).state,'scheduled');assert(await receipt());

 await assignment();edit=null;failEmail=true;beforePosts=posts;
 assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_needs_reconciliation');
 assert.equal(posts,beforePosts+1);assert.equal(await operationCount(),1);assert.equal(await receipt(),undefined);
 assert.deepEqual(await row('select state,email_state from public.icash_title_tasks where id=$1',[current.task.id]),{state:'needs_review',email_state:'needs_review'});
 assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_held');assert.equal(posts,beforePosts+1,'Unknown original email is never repeated');
 failEmail=false;
 assert.equal(await finish('late-original-provider'),true);
 assert.equal((await receipt()).provider_id,'late-original-provider');
 assert.equal((await row('select state from public.icash_title_tasks where id=$1',[current.task.id])).state,'needs_review','Late receipt preserves existing business review');
 await assignment();loseFinishAck=true;beforePosts=posts;
 assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_needs_reconciliation');
 assert.equal((await row('select state,email_state from public.icash_title_tasks where id=$1',[current.task.id])).state,'done','Lost acknowledgement cannot undo the committed original receipt');
 assert.equal((await receipt()).provider_id,'fixture-title-original-'+posts);
 assert.equal((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_held');assert.equal(posts,beforePosts+1);
 await assert.rejects(pg.query('update icash_title_task_delivery_private.receipts set provider_id=$2 where task_id=$1',[current.task.id,'replacement']),/immutable/i);
 await assert.rejects(pg.query('delete from icash_title_task_delivery_private.admissions where task_id=$1',[current.task.id]),/immutable/i);
 await assignment();emptyPdf=true;beforePosts=posts;const beforeClaims=claims;
 assert.notEqual((await fixed.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_sent');
 assert.equal(posts,beforePosts);assert.equal(claims,beforeClaims,'Empty PDF is rejected before the final claim');assert.equal(await operationCount(),0);emptyPdf=false;

 await assignment();
 try{
  await pg.exec('set role service_role');
  const source=await db('rpc/icash_title_task_delivery_snapshot','POST',{p_account:current.account,p_task:current.task.id});
  assert.equal(source.version,'title-task-delivery-v1');
  assert(await db('rpc/icash_claim_title_update','POST',{p_account:current.account,p_task:current.task.id,p_payload:current.task.payload,p_snapshot:source}),'Actual service role can claim through the reviewed entry point');
  assert.equal(await finish('service-role-original'),true);
  await assert.rejects(pg.query('select * from icash_title_task_delivery_private.receipts'),/permission denied/i);
 }finally{await pg.exec('reset role');}
 assert.equal((await receipt()).provider_id,'service-role-original');
 assert.equal((await row('select state from public.icash_title_tasks where id=$1',[current.task.id])).state,'done');
 const entries=['public.icash_prepare_title_task_delivery(uuid,uuid)','public.icash_review_title_task_preparation(uuid,uuid,jsonb,text)','public.icash_title_task_delivery_snapshot(uuid,uuid)','public.icash_claim_title_update(uuid,uuid,jsonb,jsonb)','public.icash_claim_title_followup(uuid,uuid,text)','public.icash_finish_title_task_delivery(uuid,uuid,text)','public.icash_hold_title_task_delivery(uuid,uuid)'];
 for(const signature of entries){
  const acl=await row("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service",[signature]);
  assert.deepEqual(acl,{anon:false,authenticated:false,service:true});
 }
 for(const signature of ['public.icash_claim_title_update_before_task_source(uuid,uuid,jsonb)','public.icash_claim_title_followup_before_task_source(uuid,uuid)']){
  assert.equal((await row("select has_function_privilege('service_role',$1,'EXECUTE') allowed",[signature])).allowed,false,'Service cannot bypass the new source wrapper');
 }
 for(const table of ['icash_title_task_delivery_private.admissions','icash_title_task_delivery_private.receipts','icash_title_task_delivery_private.preparation_reviews']){
  const acl=await row("select has_table_privilege('anon',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon,has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') authenticated,has_table_privilege('service_role',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') service",[table]);
  assert.deepEqual(acl,{anon:false,authenticated:false,service:false});
 }
 console.log('PASS actual corrected title service→SQL/PDF: exact source reads and final admission, original immutable receipt, edited assignment/payout/follow-up work retained, no duplicate send.');
}catch(error){
 console.error('Title original-source regression:',error.message,error.code??'',error.where??'',error.position??'',error.internalPosition??'',error.internalQuery??'');process.exitCode=1;
}finally{
 await pg.close();
 for(const key of ['DOCUSEAL_API_KEY','ICASH_LIVE_WORK_READY','RESEND_API_KEY','RESEND_RECEIVING_WEBHOOK_SECRET','ICASH_TITLE_FROM_EMAIL','ICASH_TITLE_REPLY_EMAIL']){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}
}
