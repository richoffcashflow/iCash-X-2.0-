import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {prepareTitleCopyDelivery} from '../lib/title-copy-delivery.ts';
import {titleEmailAddress} from '../lib/title-inbound-policy.ts';
import {titleConfirmationInstructionsFor} from '../lib/title-confirmation-instructions.ts';
const env={...process.env},oldFetch=globalThis.fetch;
const doc={kind:'purchase',envelopeId:'11111111-1111-4111-8111-111111111111',sourceHash:'a'.repeat(64)};
doc.pdfSource={id:doc.envelopeId,accountId:'account',dealId:'deal',kind:'purchase',state:'completed',testMode:false,providerId:'101',terms:{},termsHash:'original',templateId:'template',recipients:[],createdAt:'2026-01-01T00:00:00Z'};
let task,prepared,claimAllowed,pdfBytes,unknown,receiptFailure,posts,claims,reads,events;
const reset=()=>{task={id:'task',deal_id:'deal',state:'scheduled',email_state:'issued',payload:{type:'executed_copy',replyId:'reply',sourceHash:'b'.repeat(64),documents:[doc],linkedTasks:[]}};prepared={status:'ready',documents:[doc]};claimAllowed=true;pdfBytes=4;unknown=false;receiptFailure=false;posts=0;claims=0;reads=0;events=[];};
const db=async(path,method,args)=>{
 events.push(path);
 if(path.startsWith('icash_title_tasks?')&&!method)return [structuredClone(task)];
 if(path==='rpc/icash_prepare_title_copy')return prepared;
 if(path==='rpc/icash_claim_title_update'){claims++;assert.deepEqual(args.p_payload,task.payload);if(!claimAllowed)return null;task.email_state='dispatching';return {requestId:'request',recipient:'closer@example.invalid',address:'45 Oak Road'};}
 if(path==='rpc/icash_finish_title_copy'){assert.equal(args.p_provider,'provider-original');if(receiptFailure)throw Error('Original receipt save unavailable');task.email_state='sent';task.state='done';return true;}
 assert.equal(method,'PATCH');const expected=path.match(/email_state=eq\.([^&]+)/)?.[1];if(!expected||task.email_state===expected)Object.assign(task,args);return [];
};
const completedSigningPdf=async(account,id,audit,expected)=>{reads++;assert.equal(account,'account');assert.equal(id,doc.envelopeId);assert.equal(audit,false);assert.deepEqual(expected,doc.pdfSource);return new Uint8Array(pdfBytes);};
const deps={db,completedSigningPdf,prepareTitleCopyDelivery,titleEmailAddress,titleConfirmationInstructionsFor,closingPayoutNote:()=>''};globalThis.__copyService=deps;
const source=ts.transpileModule(readFileSync('lib/title-update-service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {dispatchTitleUpdate}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__copyService;\n'+source).toString('base64'));
const run=()=>dispatchTitleUpdate('account','task');
try{
 Object.assign(process.env,{ICASH_LIVE_WORK_READY:'true',RESEND_API_KEY:'fictional-key',RESEND_RECEIVING_WEBHOOK_SECRET:'fictional-secret',ICASH_TITLE_FROM_EMAIL:'title@example.invalid',ICASH_TITLE_REPLY_EMAIL:'reply@example.invalid'});
 globalThis.fetch=async(url,options)=>{posts++;assert.equal(url,'https://api.resend.com/emails');assert.equal(options.method,'POST');assert.equal(options.headers['Idempotency-Key'],'title-followup-task');const body=JSON.parse(options.body);assert.deepEqual(body.to,['closer@example.invalid']);assert.equal(body.attachments.length,1);assert.equal(body.attachments[0].filename,'executed-purchase-agreement.pdf');assert.match(body.subject,/Requested executed agreements/);assert.match(body.text,/terms are unchanged/);if(unknown)throw Error('Unknown original outcome');return {ok:true,json:async()=>({id:'provider-original'})};};
 reset();assert.equal((await run()).status,'title_followup_sent');assert.equal(posts,1);assert.equal(claims,1);assert.equal(reads,1);assert.equal(task.state,'done');assert.equal(events.filter(p=>p==='rpc/icash_finish_title_copy').length,1);assert.equal((await run()).status,'title_followup_held');assert.equal(posts,1);
 reset();claimAllowed=false;assert.equal((await run()).status,'title_followup_held');assert.equal(posts,0);assert.equal(reads,1);assert.equal(task.email_state,'waiting');
 reset();prepared={status:'covered_by_original_receipt'};assert.equal((await run()).status,'title_copy_original_receipt_confirmed');assert.equal(reads,0);assert.equal(posts,0);assert.equal(claims,0);
 reset();pdfBytes=21*1024*1024;assert.equal((await run()).status,'title_followup_needs_reconciliation');assert.equal(posts,0);assert.equal(claims,0);
 for(const lost of ['send','receipt']){reset();unknown=lost==='send';receiptFailure=lost==='receipt';assert.equal((await run()).status,'title_followup_needs_reconciliation');assert.equal(posts,1);assert.equal(task.email_state,'needs_review');assert.equal((await run()).status,'title_followup_held');assert.equal(posts,1,'unknown original never re-sends');}
 console.log('PASS actual title update service: exact copy preparation→final claim→one email→atomic receipt, stale source/byte limits and unknown send/save never replay.');
}finally{globalThis.fetch=oldFetch;delete globalThis.__copyService;for(const name of ['ICASH_LIVE_WORK_READY','RESEND_API_KEY','RESEND_RECEIVING_WEBHOOK_SECRET','ICASH_TITLE_FROM_EMAIL','ICASH_TITLE_REPLY_EMAIL']){if(env[name]===undefined)delete process.env[name];else process.env[name]=env[name];}}
