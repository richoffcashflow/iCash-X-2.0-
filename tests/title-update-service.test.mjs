import assert from 'node:assert/strict';
import {titleConfirmationInstructionsFor} from '../lib/title-confirmation-instructions.ts';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {closingPayoutNote} from '../lib/closing-setup.ts';
import {isDeepStrictEqual} from 'node:util';
let state='issued',taskState='scheduled',allowed=true,timeout=false,sends=0,pdfReads=0,body=null;
const assignmentId='22222222-2222-4222-8222-222222222222';
let payload={type:'assignment',envelopeId:assignmentId};
const db=async(path,method,data)=>{
 if(path==='rpc/icash_prepare_title_task_delivery'){
  const source={task:{id:'task',account_id:'account',deal_id:'deal',payload},document:payload.type==='assignment'?{pdfSource:{id:assignmentId,accountId:'account',dealId:'deal',providerId:'102'}}:null};
  return {preparation:{...source,version:'title-task-preparation-v1'},delivery:{...source,version:'title-task-delivery-v1'}};
 }
 if(path==='rpc/icash_review_title_task_preparation'){assert.equal(data.p_reason,'invalid_payout');state='needs_review';taskState='needs_review';return true;}
 if(path==='rpc/icash_claim_title_update'){assert.deepEqual(data.p_payload,payload);assert.equal(data.p_snapshot.version,'title-task-delivery-v1');if(!allowed||state!=='issued')return null;state='dispatching';return {requestId:'request',recipient:'closer@example.invalid',address:'Fixture property'};}
 if(path==='rpc/icash_finish_title_task_delivery'){assert.equal(state,'dispatching');state='sent';taskState='done';return true;}
 if(path==='rpc/icash_hold_title_task_delivery'){if(state==='dispatching'){state='needs_review';taskState='needs_review';}return true;}
 if(method==='PATCH'){
  const match=/email_state=eq\.([a-z_]+)/.exec(path);if(match&&match[1]!==state)return [];
  if(data.email_state)state=data.email_state;if(data.state)taskState=data.state;return [];
 }
 assert.match(path,/account_id=eq.account/);return [{id:'task',deal_id:'deal',state:taskState,email_state:state,payload}];
};
globalThis.__update={db,closingPayoutNote,titleConfirmationInstructionsFor,isDeepStrictEqual,titleEmailAddress:v=>v??'',completedSigningPdf:async(a,id,audit,expected)=>{assert.equal(a,'account');assert.equal(id,assignmentId);assert.equal(audit,false);assert.deepEqual(expected,{id:assignmentId,accountId:'account',dealId:'deal',providerId:'102'});pdfReads++;return new Uint8Array([1,2,3]).buffer;}};
const code=ts.transpileModule(readFileSync('lib/title-update-service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {dispatchTitleUpdate}=await import('data:text/javascript;base64,'+Buffer.from('const {db,closingPayoutNote,titleEmailAddress,completedSigningPdf,titleConfirmationInstructionsFor,isDeepStrictEqual}=globalThis.__update;\n'+code).toString('base64'));
for(const key of ['RESEND_API_KEY','RESEND_RECEIVING_WEBHOOK_SECRET','ICASH_TITLE_FROM_EMAIL','ICASH_TITLE_REPLY_EMAIL'])process.env[key]='fixture@example.invalid';process.env.ICASH_LIVE_WORK_READY='true';
process.env.DOCUSEAL_API_KEY='fictional';
const oldFetch=globalThis.fetch;globalThis.fetch=async(_url,options)=>{sends++;body=JSON.parse(options.body);assert.equal(options.headers['Idempotency-Key'],'title-followup-task');assert.deepEqual(body.to,['closer@example.invalid']);if(timeout)throw Error('timeout');return {ok:true,json:async()=>({id:'fixture-receipt'})};};
allowed=false;assert.equal((await dispatchTitleUpdate('account','task')).status,'title_followup_held');assert.equal(sends,0);
allowed=true;state='issued';assert.equal((await dispatchTitleUpdate('account','task')).status,'title_followup_sent');assert.equal(body.attachments[0].filename,'executed-assignment-agreement.pdf');assert.equal(sends,1);assert(body.text.includes('Agreement: 22222222-2222-4222-8222-222222222222'));
await dispatchTitleUpdate('account','task');assert.equal(sends,1,'Already sent task cannot replay');
state='issued';taskState='scheduled';payload={type:'payout',payout:{payeeName:'Fixture LLC',payeeType:'company',method:'check_mail',mailingAddress:'100 Fixture Lane, Dallas TX 75201'}};
const before=pdfReads;await dispatchTitleUpdate('account','task');assert.equal(pdfReads,before);assert.equal(body.attachments,undefined);assert.match(body.text,/100 Fixture Lane/);assert.match(body.text,/not verified disbursement instructions/);
state='issued';taskState='scheduled';timeout=true;assert.equal((await dispatchTitleUpdate('account','task')).status,'title_followup_needs_reconciliation');assert.equal(state,'needs_review');const count=sends;await dispatchTitleUpdate('account','task');assert.equal(sends,count);
state='issued';taskState='scheduled';timeout=false;payload={type:'payout',payout:{payeeName:'Fixture',accountNumber:'123456789'}};await dispatchTitleUpdate('account','task');assert.equal(sends,count,'Invalid sensitive payload is never sent');
globalThis.fetch=oldFetch;delete globalThis.__update;
console.log('Later title deliveries: signed attachment, exact-payload claim, preference-only update, no replay and ambiguous-delivery hold passed. No real emails.');
