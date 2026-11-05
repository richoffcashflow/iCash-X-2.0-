import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import * as policy from '../lib/workspace-assistant-policy.ts';
import * as coach from '../lib/workspace-assistant-coach.ts';
import {smsLength} from '../lib/sms-length.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const details={dealId:id(2),manual:true,purchaseSigned:true,assignmentSigned:true,buyerPrice:'$110,000',depositReceived:false,viewing:'available: Tuesday afternoon',buyerProgress:[{state:'deposit_due',next:'Confirm cleared receipt.'}],threads:[{id:id(3),party:'seller',paused:false,messages:[{id:id(5),body:'No third parties. Can you visit?',direction:'incoming',state:'received',author:'contact',at:'2026-11-04T18:00:00Z'}]},{id:id(4),party:'buyer',paused:true,messages:[{id:id(6),body:'I can pay 105k. What is next?',direction:'incoming',state:'received',author:'contact',at:'2026-11-04T19:00:00Z'},{id:id(7),body:'The asking price is $110,000.',direction:'outgoing',state:'ready',author:'you',at:'2026-11-04T19:01:00Z'}]}]};
const property={id:id(1),address:'123 Example Lane, Demo, TX',offer:'$90,000',arv:'$200,000',repairs:'$40,000',fee:'$10,000',currentCalculation:true,stage:'Buyer secured',next:'Confirm deposit.',summary:null,practice:false,coach:details};
const context={checkedAt:new Date().toISOString(),report:{days:1,leads:1,calls:2,texts:3,contracts:1},paused:false,balanceCents:500,task:'Working',active:true,needsYou:true,selectedId:id(1),hasMore:false,properties:[property]};
const reply={recommendation:'Clarify the buyer’s terms before moving forward.',reason:'A signed assignment does not confirm a cleared deposit.',steps:['Confirm cleared receipt before reserving the deal.'],question:null,actionKeys:['visits','made-up','handoff'],draft:{threadId:id(4),body:'The asking price is $110,000. What closing timeline works for you?'}};
let answer=coach.coachedAnswer(reply,context,id(1));
assert.equal(answer.actions[0].draft.latestMessageId,id(7));assert.equal(answer.actions[0].threadId,id(4));assert.equal(answer.actions[0].kind,'property');assert(smsLength(answer.coaching.draft.body).fits);
assert(answer.actions.every(a=>a.screeningId===id(1)));assert(!answer.actions.some(a=>a.label==='made-up'));
for(const body of ['Our purchase price is $90,000.','Our wholesale fee is $10,000.','I can drop it to $100,000.','Visit https://attacker.invalid','x'.repeat(161)]){
 answer=coach.coachedAnswer({...reply,draft:{threadId:id(4),body}},context,id(1));assert.equal(answer.coaching.draft,null,body);assert(!answer.actions.some(a=>a.draft));
}
answer=coach.coachedAnswer({...reply,draft:{threadId:id(99),body:'Hello'}},context,id(1));assert.equal(answer.coaching.draft,null,'Foreign thread cannot produce a send destination');
answer=coach.coachedAnswer(reply,{...context,properties:[{...property,practice:true}]},id(1));assert.equal(answer.coaching.draft,null);assert.equal(answer.actions.length,0,'Practice cannot send or hand control back');
assert.equal(coach.coachedAnswer({...reply,actionKeys:['__proto__','constructor','toString'],draft:null},context,id(1)).actions.length,0,'Prototype keys cannot create actions');
assert(!coach.coachActions({...property,coach:{...details,purchaseSigned:false}}).buyers,'No buyer marketing action before a verified purchase');
assert(!coach.coachActions({...property,stage:'Cancellation pending'}).handoff,'No resume suggestion for a stopped agreement');
for(const q of ['How do I respond to this offer?','How can I deal with this buyer?','Help me negotiate','How should I handle a seller objection?'])assert.equal(policy.localAssistantIntent(q),'coach');
async function load(path,deps,key){globalThis[key]=deps;const source=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');return import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(deps).join(',')}}=globalThis.${key};\n`+source).toString('base64'));}
const ai=await load('lib/workspace-assistant-ai.ts',{z,...policy,...coach},'__coachAI');
process.env.OPENAI_API_KEY='fixture';process.env.ICASH_SUPPORT_AI_MODEL='gpt-4.1-mini';
let response={intent:'coach',propertyId:id(1),coaching:reply},finish='stop',calls=0,settlements=[];
const fake=async(url,init)=>{calls++;const req=JSON.parse(init.body);assert.equal(req.store,false);assert.equal(req.tools,undefined);assert.equal(req.max_completion_tokens,1200);const data=JSON.parse(req.messages[1].content);assert.equal(data.properties[0].coach.depositReceived,false);assert.equal(data.properties[0].coach.threads[1].messages[1].state,'ready');assert.equal(data.properties[0].coach.threads[1].messages[1].author,'you');assert.match(data.previous[0].answer,/Clarify/);return Response.json({id:'chatcmpl-fixture',usage:{prompt_tokens:2100,completion_tokens:500},choices:[{finish_reason:finish,message:{content:JSON.stringify(response)}}]});};
const history=[{question:'What should I do?',propertyId:id(1),answer:{text:'Clarify their terms first.'}}];
const paid={before:async()=>true,after:async r=>settlements.push(r)};
let routed=await ai.routeWorkspaceQuestion('How do I answer the buyer?',context,history,fake,paid);assert.deepEqual(routed.coaching,reply);assert.equal(settlements.length,1);assert.equal(settlements[0].usage.completion_tokens,500);
response={...response,propertyId:id(99)};routed=await ai.routeWorkspaceQuestion('What next?',context,history,fake,paid);assert.equal(routed.coaching,null,'Foreign property content rejected');
response={intent:'coach',propertyId:id(1),coaching:reply};routed=await ai.routeWorkspaceQuestion('Pause my bot',context,history,fake,paid);assert.equal(routed.intent,'pause');assert.equal(routed.coaching,null,'Coaching cannot override an explicit Pause');
finish='length';routed=await ai.routeWorkspaceQuestion('What next?',context,history,fake,paid);assert.equal(routed.coaching,null,'Truncated output never becomes a partial executable suggestion');finish='stop';
response={...response,coaching:{...reply,actionKeys:['visits'],url:'https://attacker.invalid'}};routed=await ai.routeWorkspaceQuestion('What next?',context,history,fake,paid);assert.equal(routed.coaching,null,'Extra schema fields refused');
let attempts=0;await assert.rejects(ai.routeWorkspaceQuestion('What next?',context,history,fake,{before:async()=>true,after:async r=>{attempts++;assert.equal(r.providerId,'chatcmpl-fixture');throw Error('DB unavailable');}}));assert.equal(attempts,2,'Only the same original verified usage is retried; never an unverified zero');
const before=calls;await ai.routeWorkspaceQuestion('What next?',{...context,properties:[{...property,summary:'é'.repeat(20000)}]},history,fake,paid);assert.equal(calls,before,'Oversized UTF-8 input cannot spend');
console.log('PASS deal coach: grounded context, structured answers, follow-ups, account-bound actions, buyer privacy, draft limits, practice/contract guards and exact usage receipts.');
