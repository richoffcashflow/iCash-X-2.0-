import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareCompletedSellerDraft} from '../lib/automatic-contract-preparation.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
const account='account',callId='call',contact='a'.repeat(64);
let patch,paths,options;
function reset(extra={}){patch=null;paths=[];options={terms:dealTermsSchema.parse({}),transcript:[{role:'agent',message:'I accept $1.'},{role:'user',message:'My legal name is Jane Smith'},{role:'user',message:'I accept $39,000.'}],...extra};}
async function db(path,method,body){
 paths.push(path);assert(path.includes(path.startsWith('icash_accounts')?'id=eq.account':'account_id=eq.account'));
 if(method){assert.equal(method,'PATCH');assert(path.startsWith('icash_deal_files?'));assert(path.includes('stage=eq.draft'));assert(path.includes('updated_at=eq.'));assert(path.includes('&terms=eq.'));patch=body;return options.race?[]:[{id:'deal'}];}
 if(path.startsWith('icash_live_conversations'))return path.includes('&id=')?[{screening_id:'screening',party:'seller',state:options.incomplete?'waiting':'complete',result:{humanRequested:options.human,optedOut:options.stop}}]:[{id:callId,contact_key:contact,party:'seller',result:{transcript:options.transcript}},...(options.otherParty?[{id:'other',contact_key:'b'.repeat(64),party:'seller',result:{transcript:[{role:'user',message:'I accept $39,000.'}]}}]:[])];
 if(path.startsWith('icash_accounts'))return [{bot_paused:!!options.pause}];
 if(path.startsWith('icash_screening_jobs'))return [{snapshot:{propertyId:'property'}}];
 if(path.startsWith('icash_property_controls'))return [{manual:!!options.manual}];
 if(path.startsWith('icash_deal_files'))return options.noDraft?[]:[{id:'deal',terms:options.terms,updated_at:'2026-10-07T00:00:00Z'}];
 if(path.startsWith('icash_signing_envelopes'))return options.envelope?[{id:'envelope'}]:[];
 if(path.startsWith('icash_text_threads'))return [];
 throw Error(path);
}
reset();assert.equal((await prepareCompletedSellerDraft(db,account,callId)).status,'draft_prepared');
assert.equal(patch.terms.seller,'Jane Smith');assert.equal(patch.terms.priceCents,3900000);assert.equal(patch.terms.priceSource,'proposed');assert.equal(patch.terms.earnestCents,null);assert.equal(patch.terms.legalDescription,'');
for(const flag of ['incomplete','human','stop','pause','manual','noDraft','envelope']){reset({[flag]:true});assert.equal((await prepareCompletedSellerDraft(db,account,callId)).status,'draft_unchanged',flag);assert.equal(patch,null,flag);}
reset({terms:{...dealTermsSchema.parse({seller:'Saved seller',priceCents:4000000}),sourceIntake:'immutable'}});await prepareCompletedSellerDraft(db,account,callId);assert.equal(patch,null,'existing values never overwritten');
reset({terms:{...dealTermsSchema.parse({priceSource:'seller_reported'})}});await prepareCompletedSellerDraft(db,account,callId);assert.equal(patch,null,'confirmed customer terms unchanged');
reset({otherParty:true});assert.equal((await prepareCompletedSellerDraft(db,account,callId)).status,'draft_review_needed');assert.equal(patch,null);
reset({transcript:[{role:'user',message:'I accept $39,000.'},{role:'user',message:'I will not sell for that.'}]});assert.equal((await prepareCompletedSellerDraft(db,account,callId)).status,'draft_review_needed');assert.equal(patch,null);
reset({transcript:[{role:'user',message:'I accept $39,000 if you close tomorrow.'}]});await prepareCompletedSellerDraft(db,account,callId);assert.equal(patch,null);
reset({transcript:Array.from({length:151},()=>({role:'user',message:'I accept $39,000.'}))});assert.equal((await prepareCompletedSellerDraft(db,account,callId)).status,'draft_review_needed');assert.equal(patch,null);
reset({race:true});assert.equal((await prepareCompletedSellerDraft(db,account,callId)).status,'draft_unchanged');
reset({terms:{...dealTermsSchema.parse({}),sourceIntake:'immutable'}});await prepareCompletedSellerDraft(db,account,callId);assert.equal(patch.terms.sourceIntake,'immutable');
const source=readFileSync(new URL('../lib/live-conversation-service.ts',import.meta.url),'utf8');assert(source.includes("await db('rpc/icash_save_live_result','POST',{p_call:callId,p_result:result});await prepare()"));
assert(!readFileSync(new URL('../lib/automatic-contract-preparation.ts',import.meta.url),'utf8').includes('sendForSignatures'));
console.log('Automatic draft preparation: verified completed seller results, exact quotes, refusal/conflict holds, manual/pause/STOP, immutable terms, bounded history, CAS races and no send/sign passed.');
const {loadService}=await import('./helpers/simulated-journey-services.mjs');
let lifecycle=[],complete=false,failPreparation=false;
const service=await loadService('lib/live-conversation-service.ts',{
 database:async path=>{if(path.startsWith('icash_live_conversations'))return [{conversation_id:'conv_fixture',agent_id:'agent_fixture',party:'seller',state:complete?'complete':'waiting',operation_key:'voice:fixture'}];lifecycle.push(path);if(path==='rpc/icash_save_live_result')complete=true;return true;},
 elevenRequest:async()=>({}),liveConversationResult:()=>({durationSeconds:1,providerCostUsd:null,party:'seller'}),readVoiceUsagePolicies:()=>[],settleBoundVoiceUsage:async()=>{lifecycle.push('settle');return {status:'settled'};},
 prepareCompletedSellerDraft:async()=>{assert(complete,'provider result must be saved before draft assistance');lifecycle.push('prepare');if(failPreparation)throw Error('CAS/provider history read unavailable');return {status:'draft_prepared'};}
});
assert.equal((await service.reconcileLiveConversation('account','call')).status,'conversation_saved');assert(lifecycle.indexOf('rpc/icash_save_live_result')<lifecycle.indexOf('prepare'));
lifecycle=[];failPreparation=true;assert.equal((await service.reconcileLiveConversation('account','call')).billing.status,'settled');assert.deepEqual(lifecycle,['prepare','settle'],'draft failure cannot rewrite or prevent verified call billing');
console.log('Completed-call integration: preparation follows saved evidence, retries complete calls, and optional draft failures preserve billing.');
