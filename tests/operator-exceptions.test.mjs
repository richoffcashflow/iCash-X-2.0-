import assert from 'node:assert/strict';
import {collectOperatorExceptions,projectException,titleDateWindow,exceptionQuery} from '../lib/operator-exceptions.ts';
import {exceptionSources,exceptionPageSize} from '../lib/operator-exception-types.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=new Date('2026-10-02T00:45:00Z'),created='2026-09-30T00:00:00Z',base={id:id(1),account_id:id(2),created_at:created,updated_at:created};
const fixtures={
 billing:{...base,mode:'live',state:'payment_failed',reconciled_at:null},
 costs:{account_id:id(2),operation_key:'opaque-provider-reference',state:'dispatched',cost_basis:'unreconciled',created_at:created},
 texts:{...base,state:'needs_review',direction:'outgoing'},emails:{...base,state:'accepted',direction:'outgoing',delivery_state:'bounced'},
 voice_jobs:{...base,state:'held'},call_results:{...base,state:'review'},property_checks:{...base,state:'failed'},
 title_tasks:{...base,state:'scheduled',kind:'deadline',due_date:'2026-10-01',email_state:'waiting'},
 attention_emails:{...base,state:'suppressed'},support:{...base,status:'escalated'},
};
for(const source of exceptionSources){const item=projectException(source,{...fixtures[source],body:'PRIVATE BODY',provider_id:'PRIVATE TOKEN',recipient:'private@example.com'},now);assert(item,source);assert.equal(item.accountId,id(2));assert(!JSON.stringify(item).includes('PRIVATE'));assert(!JSON.stringify(item).includes('private@example.com'));}
assert(!JSON.stringify(projectException('costs',fixtures.costs,now)).includes('opaque-provider-reference'));
assert.match(projectException('costs',fixtures.costs,now).recordId,/^sha256:[a-f0-9]{64}$/);
assert.equal(projectException('billing',{...fixtures.billing,mode:'test'},now),null);
assert.equal(projectException('billing',{...fixtures.billing,state:'active'},now),null);
assert.match(projectException('billing',{...fixtures.billing,state:'stop_requested'},now).title,/not yet confirmed/);
assert.equal(projectException('texts',{...fixtures.texts,direction:'incoming'},now),null);
for(const source of ['texts','emails','voice_jobs']){
 const row={...fixtures[source],state:'dispatching',delivery_state:null,updated_at:'2026-10-02T00:44:59Z'};
 assert.equal(projectException(source,row,now),null,'Fresh dispatch is not failed');
 row.updated_at='2026-10-02T00:30:00Z';assert(projectException(source,row,now));
}
assert.equal(projectException('costs',{...fixtures.costs,created_at:'2026-10-01T00:45:01Z'},now),null);
assert.equal(projectException('costs',{...fixtures.costs,state:'settled',cost_basis:'verified'},now),null);
for(const cost_basis of ['estimated','unreconciled'])assert.match(projectException('costs',{...fixtures.costs,state:'settled',cost_basis},now).detail,/not a supplier invoice/);
assert.deepEqual(titleDateWindow(now),{today:'2026-10-01',through:'2026-10-03'},'Title checks must use Chicago, not UTC calendar date');
const confirmed=projectException('title_tasks',fixtures.title_tasks,now);assert.match(confirmed.title,/approaching/);assert.equal(confirmed.dueDate,'2026-10-01');
assert.match(projectException('title_tasks',{...fixtures.title_tasks,due_date:'2026-09-30'},now).title,/overdue/);
assert.equal(projectException('title_tasks',{...fixtures.title_tasks,due_date:'2026-10-04'},now),null);
const suggested=projectException('title_tasks',{...fixtures.title_tasks,state:'needs_review',due_date:'2026-09-30'},now);assert(!suggested.dueDate);assert.match(suggested.detail,/not a confirmed deadline/);assert.doesNotMatch(suggested.title,/overdue/);
assert.equal(projectException('title_tasks',{...fixtures.title_tasks,state:'done'},now),null);
assert.equal(projectException('title_tasks',{...fixtures.title_tasks,due_date:'2026-02-30'},now),null);
assert.equal(projectException('attention_emails',{...fixtures.attention_emails,state:'claimed',created_at:now.toISOString()},now),null);
assert.match(projectException('attention_emails',fixtures.attention_emails,now).nextStep,/Honor suppression/);
assert.throws(()=>projectException('texts',{...fixtures.texts,account_id:'injected&select=*'},now));
assert.throws(()=>projectException('emails',{...fixtures.emails,state:'SECRET'},now));
assert.throws(()=>exceptionQuery.parse({source:'billing',page:0,accountId:id(99)}));
for(const page of [-1,1.5,1001,'garbage'])assert.throws(()=>exceptionQuery.parse({page}));
assert.deepEqual(exceptionQuery.parse({source:'billing',page:'2'}),{source:'billing',page:2});
const sourceByTable={icash_daily_plans:'billing',icash_operation_spend:'costs',icash_text_messages:'texts',icash_deal_emails:'emails',icash_voice_jobs:'voice_jobs',icash_live_conversations:'call_results',icash_screening_jobs:'property_checks',icash_title_tasks:'title_tasks',icash_attention_emails:'attention_emails',icash_support_threads:'support'};
let calls=[],inflight=0,max=0;
async function database(path,method,body,signal){
 calls.push(path);assert.equal(method,'GET');assert.equal(body,undefined);assert(signal instanceof AbortSignal);
 inflight++;max=Math.max(max,inflight);await new Promise(r=>setTimeout(r,1));inflight--;
 if(path.startsWith('icash_accounts?'))return [{id:id(2)}];
 assert(path.includes('account_id=not.is.null'));assert(path.includes('limit=21'));assert(path.includes('offset=0'));
 return [fixtures[sourceByTable[path.split('?')[0]]]];
}
let snapshot=await collectOperatorExceptions(database,{page:0},now);
assert.equal(snapshot.sections.length,exceptionSources.length);assert.equal(snapshot.partial,false);assert.equal(snapshot.sections.reduce((n,s)=>n+s.items.length,0),10);assert(max<=3);assert.equal(calls.length,11);
assert(!calls.some(p=>p.includes('select=*')||p.startsWith('rpc/')));
assert(calls.find(p=>p.startsWith('icash_title_tasks')).includes('due_date.lte.2026-10-03'));
assert(calls.find(p=>p.startsWith('icash_daily_plans')).includes('mode=eq.live'));
let reads=0;snapshot=await collectOperatorExceptions(async path=>{reads++;if(path.startsWith('icash_accounts'))return [{id:id(2)}];assert(path.includes('offset=40'));return Array.from({length:21},(_,n)=>({...fixtures.billing,id:id(n+10)}));},{source:'billing',page:2},now);
assert.equal(reads,2);assert.equal(snapshot.sections[0].items.length,20);assert.equal(snapshot.sections[0].hasMore,true);
snapshot=await collectOperatorExceptions(async path=>{if(path.startsWith('icash_accounts'))return [];return [fixtures.billing];},{source:'billing',page:0},now);assert(snapshot.partial);assert.equal(snapshot.sections[0].items.length,0,'Unknown account rows stay hidden');
snapshot=await collectOperatorExceptions(async path=>{if(path.startsWith('icash_accounts'))throw Error('private backend error');return [fixtures.billing];},{source:'billing',page:0},now);assert(snapshot.partial);assert.equal(snapshot.sections[0].items.length,0);assert(!JSON.stringify(snapshot).includes('private backend error'));
snapshot=await collectOperatorExceptions(async()=>{throw Error('source offline');},{source:'billing',page:0},now);assert(snapshot.partial);assert.equal(snapshot.sections[0].status,'unavailable');
snapshot=await collectOperatorExceptions(async()=>[{...fixtures.billing,created_at:'bad'}],{source:'billing',page:0},now);assert(snapshot.partial);
snapshot=await collectOperatorExceptions(async()=>({data:[]}),{source:'billing',page:0},now);assert(snapshot.partial,'Invalid responses cannot become healthy empty arrays');
const canceled=new AbortController();canceled.abort();let attempted=0;snapshot=await collectOperatorExceptions(async()=>{attempted++;return [];},{source:'billing',page:0},now,canceled.signal);assert.equal(attempted,0);assert(snapshot.partial);
assert.equal(exceptionPageSize,20);
console.log('Operator exception projection and read-only collection passed: truthful states, Chicago deadlines, live/test separation, evidence minimization, bounded paging/concurrency, account verification and partial failures.');
