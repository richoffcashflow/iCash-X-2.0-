import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {installTitleCopyFixture,installTitleCopyMigration,titleCopyCase,sendTitleCopyReply} from './fixtures/title-copy-fixture.mjs';
import {prepareTitleCopyDelivery} from '../lib/title-copy-delivery.ts';
import {titleEmailAddress} from '../lib/title-inbound-policy.ts';
import {titleConfirmationInstructionsFor} from '../lib/title-confirmation-instructions.ts';
const sql=new PGlite(),env={...process.env},oldFetch=globalThis.fetch;
let current,posts=0,edit;
const db=async(path,method,args)=>{
 if(!method&&path.startsWith('icash_title_tasks?'))return (await sql.query('select * from public.icash_title_tasks where id=$1 and account_id=$2',[current.task.id,current.account])).rows;
 assert.equal(method,'POST');
 if(path==='rpc/icash_prepare_title_copy'||path==='rpc/icash_claim_title_update'){
  const name=path.slice(4);return (await sql.query(`select public.${name}($1,$2,$3) value`,[args.p_account,args.p_task,args.p_payload])).rows[0].value;
 }
 assert.equal(path,'rpc/icash_finish_title_copy');
 return (await sql.query('select public.icash_finish_title_copy($1,$2,$3) value',[args.p_account,args.p_task,args.p_provider])).rows[0].value;
};
const deps={db,prepareTitleCopyDelivery,titleEmailAddress,titleConfirmationInstructionsFor,closingPayoutNote:()=>'',completedSigningPdf:async()=>new Uint8Array([1,2,3]).buffer};
globalThis.__titleCopyReceiptService=deps;
const source=ts.transpileModule(readFileSync('lib/title-update-service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {dispatchTitleUpdate}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__titleCopyReceiptService;\n'+source).toString('base64'));
try{
 await installTitleCopyFixture(sql);await installTitleCopyMigration(sql);
 await sql.exec("update icash_title_copy_private.policy set enabled=true,activated_at=now()-interval '1 minute',release_sha=repeat('a',40)");
 Object.assign(process.env,{ICASH_LIVE_WORK_READY:'true',RESEND_API_KEY:'fictional',RESEND_RECEIVING_WEBHOOK_SECRET:'fictional',ICASH_TITLE_FROM_EMAIL:'title@example.invalid',ICASH_TITLE_REPLY_EMAIL:'reply@example.invalid'});
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.resend.com/emails');assert.equal(options.method,'POST');posts++;
  const body=JSON.parse(options.body);assert.equal(body.attachments.length,1);
  assert.equal((await sql.query('select email_state from public.icash_title_tasks where id=$1',[current.task.id])).rows[0].email_state,'dispatching');
  await sql.query('update public.icash_title_tasks set '+edit+' where id=$1',[current.task.id]);
  return {ok:true,json:async()=>({id:'original-service-receipt-'+posts})};
 };
 for(edit of ["label='Manual added evidence',payload=payload||'{\"manualReview\":true}'::jsonb","reply_id=null"]){
  current=await titleCopyCase(sql);current.reply=await sendTitleCopyReply(sql,current,'Please send the purchase agreement.');
  current.task=(await sql.query('select * from public.icash_title_tasks where reply_id=$1',[current.reply.id])).rows[0];
  await sql.query("update public.icash_title_tasks set email_state='issued' where id=$1",[current.task.id]);
  assert.equal((await dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_sent','Known original delivery is recorded');
  const row=(await sql.query('select * from public.icash_title_tasks where id=$1',[current.task.id])).rows[0];
  assert.equal(row.state,'scheduled','Changed work is not completed');
  assert.equal((await sql.query('select needs_review from public.icash_title_replies where id=$1',[current.reply.id])).rows[0].needs_review,true);
  assert.equal((await sql.query('select provider_id from icash_title_copy_private.receipts where task_id=$1',[current.task.id])).rows[0].provider_id,'original-service-receipt-'+posts);
  const before=posts;assert.equal((await dispatchTitleUpdate(current.account,current.task.id)).status,'title_followup_held');assert.equal(posts,before,'No second send after changed-work receipt');
 }
 console.log('PASS actual title service → SQL: original receipt survives task/source association edits; changed work and review stay open; no replay.');
}finally{
 await sql.close();globalThis.fetch=oldFetch;delete globalThis.__titleCopyReceiptService;
 for(const key of ['ICASH_LIVE_WORK_READY','RESEND_API_KEY','RESEND_RECEIVING_WEBHOOK_SECRET','ICASH_TITLE_FROM_EMAIL','ICASH_TITLE_REPLY_EMAIL']){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}
}
