import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {analysisMoney} from '../lib/property-analysis-view.ts';
import {journeyNextAction} from '../lib/deal-journey-progress.ts';
import {redactSupportQuestion} from '../lib/support-policy.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),screening=id(2),deal=id(3),thread=id(4),assignment=id(5);let paths=[],duplicateAssignment=false,networkFail=false;
const db=async(path,method,body)=>{
 paths.push(path);
 if(path.startsWith('rpc/')){assert.equal(body.p_account,account);assert(!method||method==='POST');}
 else{assert.equal(method,undefined,'Context never writes');assert(path.includes('account_id=eq.'+account),'Every privileged table read is account bound');}
 if(path.startsWith('icash_signing_envelopes'))return [{id:id(6),kind:'purchase',state:'completed',test_mode:false},{id:assignment,kind:'assignment',state:'completed',test_mode:false},...(duplicateAssignment?[{id:id(7),kind:'assignment',state:'completed',test_mode:false}]:[])];
 if(path.startsWith('icash_property_controls'))return [{manual:true}];
 if(path.startsWith('icash_buyer_package_links'))return [{asking_price_cents:11000000}];
 if(path.startsWith('icash_seller_viewing_availability'))return [{quote:'Available Tuesday, no time confirmed',state:'available'}];
 if(path.startsWith('icash_text_messages')){assert(path.includes('thread.account_id=eq.'+account));assert(path.includes('thread.deal_id=eq.'+deal));assert(path.includes('thread.retired_at=is.null'));assert(path.includes('order=created_at.desc,id.desc'));if(!path.includes('thread.party=eq.buyer'))return [];return [{id:id(9),body:'Our price is $110,000.',direction:'outgoing',state:'ready',customer_author_id:account,created_at:'2026-11-04T18:01:00Z'},{id:id(8),body:'I can do 105k.',direction:'incoming',state:'received',customer_author_id:null,created_at:'2026-11-04T18:00:00Z'}].map(m=>({...m,thread:{id:thread,party:'buyer',paused:true}}));}
 if(path.startsWith('icash_buyer_deposit_receipts')){assert(path.includes('envelope_id=eq.'+assignment));return [];}
 if(path==='rpc/icash_network_workspace'){if(networkFail)throw Error('Unavailable');assert.equal(body.p_deal,deal);return {buyers:[{state:'replied',reply:'Can I see it?',email:'never-send@example.invalid'}]};}
 if(path==='rpc/icash_buyer_reception_calls')return [{summary:'Buyer asked for access; no showing booked.'}];
 if(path==='rpc/icash_journey_progress'){assert.deepEqual(body.p_screenings,[screening]);return [{id:id(10),deal_id:deal,screening_id:screening,state:'deposit_due',messageReview:false}];}
 throw Error(path);
};
globalThis.__coachContext={db,analysisMoney,journeyNextAction,redactSupportQuestion};
const code=ts.transpileModule(readFileSync(new URL('../lib/workspace-assistant-deal-context.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {assistantDealContext}=await import('data:text/javascript;base64,'+Buffer.from('const {db,analysisMoney,journeyNextAction,redactSupportQuestion}=globalThis.__coachContext;\n'+code).toString('base64'));
let context=await assistantDealContext(account,screening,'prop_example',deal);
assert.equal(context.purchaseSigned,true);assert.equal(context.assignmentSigned,true);assert.equal(context.depositReceived,false,'Signature never means deposit');assert.equal(context.buyerPrice,'$110,000');assert.equal(context.threads[0].messages[0].author,'contact');assert.equal(context.threads[0].messages[1].author,'you');assert.equal(context.threads[0].messages[1].state,'ready','Unsent copy stays unsent');assert.match(context.buyerProgress[0].next,/cleared receipt/);assert(!JSON.stringify(context).includes('never-send@example.invalid'));
duplicateAssignment=true;paths=[];context=await assistantDealContext(account,screening,'prop_example',deal);assert.equal(context.depositReceived,false);assert(!paths.some(p=>p.startsWith('icash_buyer_deposit_receipts')),'Ambiguous signed assignment never attaches another deposit');
networkFail=true;await assert.rejects(assistantDealContext(account,screening,'prop_example',deal),/Unavailable/,'A failed context read must not turn into an empty buyer history');
console.log('PASS coaching context: scoped bounded reads, seller/buyer states, incoming calls, email replies, original authors and exact signed-deposit binding.');
