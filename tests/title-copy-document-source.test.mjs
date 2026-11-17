import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {normalizeDocuseal as normalize} from '../lib/docuseal-policy.ts';
import {verifiedSigningStatus} from '../lib/signing-policy.ts';
import {prepareTitleCopyDelivery} from '../lib/title-copy-delivery.ts';
import {titleEmailAddress} from '../lib/title-inbound-policy.ts';
import {titleConfirmationInstructionsFor} from '../lib/title-confirmation-instructions.ts';
import {installTitleCopyFixture,installTitleCopyMigration,titleCopyCase,sendTitleCopyReply} from './fixtures/title-copy-fixture.mjs';
const sql=new PGlite(),env={...process.env};let current,transient=true,gets=0,posts=0,attachment;
const row=async(q,args)=>(await sql.query(q,args)).rows[0];
const db=async(path,method,args)=>{
 if(!method&&path.startsWith('icash_title_tasks?'))return (await sql.query('select * from public.icash_title_tasks where id=$1 and account_id=$2',[current.task.id,current.account])).rows;
 if(!method&&path.startsWith('icash_signing_envelopes?')){
  if(transient)await sql.query("update public.icash_signing_envelopes set provider_id='202' where id=$1",[current.purchase]);
  const envelope=await row('select * from public.icash_signing_envelopes where id=$1',[current.purchase]);
  await sql.query("update public.icash_signing_envelopes set provider_id='101' where id=$1",[current.purchase]);
  envelope.created_at=new Date(envelope.created_at).toISOString();return [envelope];
 }
 if(method==='PATCH')return [];
 assert.equal(method,'POST');
 if(path==='rpc/icash_prepare_title_copy'||path==='rpc/icash_claim_title_update')return (await row(`select public.${path.slice(4)}($1,$2,$3) value`,[args.p_account,args.p_task,args.p_payload])).value;
 assert.equal(path,'rpc/icash_finish_title_copy');return (await row('select public.icash_finish_title_copy($1,$2,$3) value',[args.p_account,args.p_task,args.p_provider])).value;
};
const signing=await loadService('lib/signing-service.ts',{db,z,normalize,verifiedSigningStatus,isDeepStrictEqual,fetch:async(url)=>{
 gets++;const id=transient?202:101;
 if(String(url).includes('/documents?'))return Response.json([{url:`https://docuseal.com/file/${id}.pdf`}]);
 if(String(url).includes('api.docuseal.com')){const completed=new Date(Date.now()-2*60*60*1000).toISOString();return Response.json({id,submitters_order:'preserved',completed_at:completed,submitters:[1,2].map(i=>({id:i,submission_id:id,email:`signer${i}@example.invalid`,external_id:`${current.purchase}:${i}`,status:'completed',completed_at:completed,metadata:{terms_hash:'fixture-terms'}}))});}
 return new Response('%PDF-'+id,{headers:{'Content-Type':'application/pdf'}});
}});
const service=await loadService('lib/title-update-service.ts',{db,completedSigningPdf:signing.completedSigningPdf,prepareTitleCopyDelivery,titleEmailAddress,titleConfirmationInstructionsFor,closingPayoutNote:()=>'',fetch:async(url,options)=>{
 assert.equal(url,'https://api.resend.com/emails');posts++;attachment=JSON.parse(options.body).attachments[0].content;return Response.json({id:'fixture-copy-receipt'});
}});
try{
 await installTitleCopyFixture(sql);await installTitleCopyMigration(sql);
 await sql.exec("update icash_title_copy_private.policy set enabled=true,activated_at=now()-interval '1 minute',release_sha=repeat('a',40)");
 Object.assign(process.env,{DOCUSEAL_API_KEY:'fictional',ICASH_LIVE_WORK_READY:'true',RESEND_API_KEY:'fictional',RESEND_RECEIVING_WEBHOOK_SECRET:'fictional',ICASH_TITLE_FROM_EMAIL:'title@example.invalid',ICASH_TITLE_REPLY_EMAIL:'reply@example.invalid'});
 current=await titleCopyCase(sql);
 await sql.query('update public.icash_signing_envelopes set recipients=$2 where id=$1',[current.purchase,[1,2].map(i=>({id:String(i),email:`signer${i}@example.invalid`}))]);
 current.reply=await sendTitleCopyReply(sql,current,'Please send the purchase agreement.');current.task=await row('select * from public.icash_title_tasks where reply_id=$1',[current.reply.id]);
 await sql.query("update public.icash_title_tasks set email_state='issued' where id=$1",[current.task.id]);
 const result=await service.dispatchTitleUpdate(current.account,current.task.id);
 assert.equal(result.status,'title_followup_spending_held');assert.equal(gets,0,'Transient replacement is refused before any provider GET');assert.equal(posts,0);
 assert.equal((await row('select count(*)::int n from public.icash_operation_spend where operation_key=$1',['title-followup:'+current.task.id])).n,0);
 for(const mutation of [
  "update public.icash_signing_envelopes set created_at=now()-interval '5 seconds' where id=$1",
  "update public.icash_deal_files set assignment_signed_at=now()-interval '5 seconds' where id=$2",
  "update public.icash_deal_files set assignment_signed_at=null where id=$2",
  "update public.icash_deal_files set assignment_signed_at='infinity' where id=$2",
  "update public.icash_signing_envelopes set terms='{}' where id=$1",
 ]){
  const c=await titleCopyCase(sql);await sql.query(mutation.replace('$2','$1'),[mutation.includes('$2')?c.deal:c.assignment]);
  const reply=await sendTitleCopyReply(sql,c,'Please send the assignment agreement.',{source:{providerReceivedAt:new Date(Date.now()-15000).toISOString()}});
  assert.equal((await row('select kind from public.icash_title_tasks where reply_id=$1',[reply.id])).kind,'reply_review',mutation);
 }
 const replacement=await titleCopyCase(sql);
 await sql.query("update public.icash_signing_envelopes set created_at=now()-interval '10 seconds' where id=$1",[replacement.assignment]);
 await sql.query("update public.icash_deal_files set assignment_signed_at=now()-interval '5 seconds' where id=$1",[replacement.deal]);
 await sql.query("insert into public.icash_agreement_cancellations(account_id,deal_id,kind,state,completed_at) values($1,$2,'assignment','completed',now()-interval '20 seconds')",[replacement.account,replacement.deal]);
 const delayed=await sendTitleCopyReply(sql,replacement,'Please send the assignment agreement.',{source:{providerReceivedAt:new Date(Date.now()-30000).toISOString()}});
 assert.equal((await row('select kind from public.icash_title_tasks where reply_id=$1',[delayed.id])).kind,'reply_review');
 const fresh=await sendTitleCopyReply(sql,replacement,'Please send the assignment agreement.');
 const freshTask=await row('select * from public.icash_title_tasks where reply_id=$1',[fresh.id]);
 assert.equal(freshTask.kind,'document_update','Fresh verified request after replacement signature is eligible');
 await sql.query("update public.icash_title_tasks set email_state='issued' where id=$1",[freshTask.id]);
 assert((await row('select public.icash_claim_title_update($1,$2,$3) value',[replacement.account,freshTask.id,freshTask.payload])).value,'Fresh verified replacement copy passes the actual final claim');
 await sql.query("update public.icash_signing_envelopes set created_at=now()-interval '2 minutes' where id=$1",[replacement.assignment]);
 await sql.query("update public.icash_deal_files set assignment_signed_at=now()-interval '30 seconds' where id=$1",[replacement.deal]);
 assert.equal((await row('select icash_title_copy_private.current_request($1) value',[fresh.id])).value.documents.length,0,'Signature observation before cancellation cannot bind the replacement');
 transient=false;current=await titleCopyCase(sql);
 await sql.query('update public.icash_signing_envelopes set recipients=$2 where id=$1',[current.purchase,[1,2].map(i=>({id:String(i),email:`signer${i}@example.invalid`}))]);
 current.reply=await sendTitleCopyReply(sql,current,'Please send the purchase agreement.');current.task=await row('select * from public.icash_title_tasks where reply_id=$1',[current.reply.id]);
 await sql.query("update public.icash_title_tasks set email_state='issued' where id=$1",[current.task.id]);
 assert.equal((await service.dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_sent');assert.equal(gets,3);assert.equal(posts,1);assert.equal(Buffer.from(attachment,'base64').toString(),'%PDF-101');
 console.log('PASS actual copy service→SQL→PDF: transient source replacement has zero provider reads/send/reservation; old source and invalid signature clocks hold; fresh postreplacement source and exact PDF dispatch succeed.');
}catch(error){console.error(error.message,error.code,error.where);process.exitCode=1;}finally{await sql.close();for(const key of ['DOCUSEAL_API_KEY','ICASH_LIVE_WORK_READY','RESEND_API_KEY','RESEND_RECEIVING_WEBHOOK_SECRET','ICASH_TITLE_FROM_EMAIL','ICASH_TITLE_REPLY_EMAIL']){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}}
