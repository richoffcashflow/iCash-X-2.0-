process.env.ICASH_LIVE_WORK_READY='true'; // Ready-state provider fixtures only.
import {closingPayoutNote} from '../lib/closing-setup.ts';
import {titleConfirmationInstructionsFor} from '../lib/title-confirmation-instructions.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
let state='ready',allow=true,sends=0,timeout=false,records=[],assignments=[],payload=null;
const purchaseId='11111111-1111-4111-8111-111111111111',assignmentId='22222222-2222-4222-8222-222222222222';
const delivery=()=>({version:'title-delivery-v1',request:{id:'job',accountId:'account',dealId:'deal',purchaseEnvelopeId:purchaseId,recipient:'escrow@example.invalid',propertyAddress:'Fixture',rateId:'rate',verifiedUntil:'2099-01-01'},dealTerms:{},purchase:{id:purchaseId},assignments,payout:null});
const db=async(path,method,body)=>{records.push({path,method,body});if(path.startsWith('icash_title_followup_settings'))return [{enabled:true}];if(path.startsWith('icash_title_contacts'))return [{email:'escrow@example.invalid'}];if(path==='rpc/icash_prepare_title_request')return {id:'job',state};if(path==='rpc/icash_title_request_delivery_snapshot')return state==='ready'?delivery():null;if(method==='PATCH'){state=body.state;return [];}if(path==='rpc/icash_claim_title_request_snapshot'){assert.deepEqual(body.p_expected,delivery());if(allow)state='dispatching';return allow;}throw Error('Unexpected title path '+path);};
globalThis.__title={closingPayoutNote,titleConfirmationInstructionsFor,db,reserveOperation:async()=>{},completedSigningPdf:async()=>new Uint8Array([1,2,3]).buffer};
const realFetch=globalThis.fetch;globalThis.fetch=async(_url,options)=>{payload=JSON.parse(options.body);sends++;if(timeout)throw Error('timeout');return {ok:true,json:async()=>({id:'email_fixture'})};};
process.env.ICASH_TITLE_REPLY_EMAIL='reply@example.invalid';process.env.RESEND_API_KEY='fixture';process.env.RESEND_RECEIVING_WEBHOOK_SECRET='fixture';process.env.ICASH_TITLE_FROM_EMAIL='fixture@example.invalid';
let source=ts.transpileModule(readFileSync('lib/title-service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {dispatchTitleRequest,coordinateTitleOpening}=await import('data:text/javascript;base64,'+Buffer.from('const {closingPayoutNote,titleConfirmationInstructionsFor,db,reserveOperation,completedSigningPdf}=globalThis.__title;\n'+source).toString('base64'));
delete process.env.RESEND_RECEIVING_WEBHOOK_SECRET;
assert.equal((await dispatchTitleRequest('account','job')).status,'title_configuration_required');assert.equal(sends,0);
process.env.RESEND_RECEIVING_WEBHOOK_SECRET='fixture';
assert.equal((await dispatchTitleRequest('account','job')).status,'title_request_sent');assert.equal(sends,1);assert(payload.text.includes('Agreement: '+purchaseId));await dispatchTitleRequest('account','job');assert.equal(sends,1);
state='ready';allow=false;await dispatchTitleRequest('account','job');assert.equal(sends,1);
state='ready';allow=true;timeout=true;assert.equal((await dispatchTitleRequest('account','job')).status,'title_delivery_needs_reconciliation');await dispatchTitleRequest('account','job');assert.equal(sends,2);
assert(!records.some(r=>r.body?.stage==='title_open'||r.body?.stage==='closed'));
timeout=false;state='ready';assignments=[{id:assignmentId}];
assert.equal((await dispatchTitleRequest('account','job')).status,'title_request_sent');
assert.deepEqual(payload.attachments.map(a=>a.filename),['executed-purchase-agreement.pdf','executed-assignment-agreement.pdf']);
assert.match(payload.text,/buyer-paid closing costs/);assert(payload.text.includes('Agreement: '+assignmentId));assert(!payload.text.includes('Agreement: '+purchaseId));
assert(records.some(r=>r.path==='rpc/icash_title_request_delivery_snapshot'&&r.body.p_account==='account'&&r.body.p_id==='job'));
state='ready';assignments=[{id:assignmentId},{id:'conflicting'}];const before=sends;
assert.equal((await dispatchTitleRequest('account','job')).status,'title_assignment_review_required');assert.equal(sends,before);
for(const [savedState,status] of [['sent','title_request_already_sent'],['needs_review','title_request_already_held'],['dispatching','title_request_already_held']]){
 state=savedState;records=[];
 assert.equal((await coordinateTitleOpening('account','deal')).status,status);
 assert.equal(sends,before,'existing title states never resend');
 assert(!records.some(r=>r.path.startsWith('icash_signing_envelopes')),'no new email package for an existing title job');
}
globalThis.fetch=realFetch;delete globalThis.__title;delete process.env.RESEND_API_KEY;delete process.env.RESEND_RECEIVING_WEBHOOK_SECRET;delete process.env.ICASH_TITLE_FROM_EMAIL;
console.log('Title delivery: claim gate, no replay, ambiguous delivery hold, no fabricated closing status passed. No emails sent.');
