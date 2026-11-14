import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {planSellerProgress,sellerProgressInstructions} from '../lib/seller-progress-policy.ts';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const fixture=read('./helpers/seller-progress-fixture.sql'),split=fixture.indexOf('create function icash_queue_ai_reply(');
const fn=(file,name)=>{const s=read('../config/'+file+'.sql'),start=s.indexOf('create function public.'+name+'(');assert(start>=0,name);const tag=s.slice(start).match(/\bas (\$[A-Za-z_]*\$)/i)[1],body=s.indexOf(tag,start);return s.slice(start,s.indexOf(tag+';',body+tag.length)+tag.length+1);};
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
const rpc=async(n,args=[])=>Object.values(await one(`select ${n}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args))[0];
await pg.exec(fixture.slice(0,split)+read('./fixtures/seller-progress-original-functions.sql')+fixture.slice(split)+read('./helpers/seller-dialogue-fixture.sql')+read('./fixtures/seller-dialogue-original-functions.sql')+
 fn('seller-response-policy','icash_seller_direct_response_match')+fn('seller-response-policy','icash_seller_response_disposition')+fn('seller-gap-recovery','icash_seller_contact_stop')+
 `create trigger icash_text_ai_incoming after insert on icash_text_messages for each row execute function icash_enqueue_text_ai();`+read('../config/seller-reply-progress.sql')+read('../config/seller-dialogue.sql'));
await pg.exec('update icash_seller_progress_settings set enabled=true,dialogue_enabled=true');
let tick=0;
const at=()=>new Date(Date.now()-300000+(++tick)*1000).toISOString();
async function seed(){const a=randomUUID(),t=randomUUID(),d=randomUUID(),s=randomUUID(),phone='+1555'+Math.floor(Math.random()*9999999).toString().padStart(7,'0');
 await q('insert into icash_accounts(id) values($1)',[a]);
 await q("insert into icash_screening_jobs(id,account_id,snapshot,result) values($1,$2,$3,$4)",[s,a,{propertyId:s},{financialCheck:{status:'eligible'},preliminarySellerCeilingCents:12938400}]);
 await q("insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,$4)",[d,a,s,{address:'Fixture property'}]);
 await q('insert into icash_text_threads(id,account_id,deal_id,recipient) values($1,$2,$3,$4)',[t,a,d,phone]);
 await q("insert into icash_sms_routes(sender,recipient,account_id) values('+15550000001',$1,$2)",[phone,a]);return {a,t,d,s};
}
async function incoming(c,body,extra={}){const event=extra.event??randomUUID();const m=(await one("insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id,created_at,attachments) values($1,$2,'incoming','received',$3,$4,$5,$6) on conflict(event_id) do update set body=icash_text_messages.body returning id",[c.a,c.t,body,event,extra.at??at(),extra.attachments??[]])).id;return {m,j:(await one('select * from icash_text_ai_jobs where message_id=$1',[m]))};}
const context=(c,m)=>rpc('icash_seller_dialogue_context',[c.a,m]);
const progress=(c,m)=>rpc('icash_refresh_seller_reply_progress',[c.a,m]);
async function dispatch(c,j,{delivered=true}={}){const resumed=await rpc('icash_resume_seller_text_ai',[c.a,j.id]);assert.equal(resumed.mode,'dispatch',JSON.stringify(resumed));
 const msg=await one('select * from icash_text_messages where id=$1',[resumed.messageId]);assert(msg.body.length<=160,msg.body);
 assert.ok(await rpc('icash_claim_text',[c.a,msg.id,'+15550000001']),'Actual production campaign/final-message guard admits expected copy');
 assert.equal(await rpc('icash_claim_text',[c.a,msg.id,'+15550000001']),null,'One provider claim only');
 await q("update icash_text_messages set state=$2,provider_id=$3,created_at=$4 where id=$1",[msg.id,delivered?'delivered':'accepted','provider-'+msg.id,at()]);await progress(c,j.message_id);return msg;
}

// Install exact current production admission guards, with external budget and
// transport delegates remaining fixture-only. No provider is contacted.
await pg.exec(`
 create table icash_contract_text_deliveries(envelope_id uuid,account_id uuid,message_id uuid);
 create schema icash_seller_agreement_private;create schema icash_call_offer_private;
 create table icash_seller_agreement_private.confirmations(envelope_id uuid,account_id uuid,deal_id uuid);
 create table icash_call_offer_private.offers(account_id uuid,deal_id uuid);
 create function icash_confirmed_seller_contract_text_current(uuid,uuid) returns boolean language sql as $$select false$$;
`+read('./fixtures/seller-information-reply-before.sql'));
const age=async c=>q("update icash_screening_jobs set completed_at=now()-interval '24 hours 13 minutes' where id=$1",[c.s]);

const patch=read('../config/seller-information-reply-liveness.sql');
const recovery=read('../config/seller-information-source-recovery.sql');
assert.equal(recovery,read('../supabase/migrations/20261114172822_seller_information_source_recovery.sql'));
await pg.exec('create table icash_operation_spend(operation_key text primary key,account_id uuid);');
const cases=[];
async function held(){const c=await seed();await age(c);const turn=await incoming(c,'How much ');assert.equal(turn.j.state,'needs_review');return {...c,...turn,hash:createHash('sha256').update('How much ').digest('hex')};}
// Produce each failure with the unmodified production predecessor, then install
// the prospective fix. These are original, never-attempted held sources.
for(let i=0;i<22;i++)cases.push(await held());
await pg.exec('begin;'+patch+recovery+'commit;');
const recover=c=>rpc('icash_seller_information_private.recover',[c.a,c.m,c.j.id,c.hash]);
const state=async c=>(await one('select to_jsonb(j) j from icash_text_ai_jobs j where id=$1',[c.j.id])).j;
const receipt=c=>one('select * from icash_seller_information_private.recoveries where job_id=$1',[c.j.id]);
async function reject(c,reason){const before=await state(c),prior=(await one('select to_jsonb(p) p from icash_seller_reply_progress p where message_id=$1',[c.m]))?.p;const result=await recover(c);assert.equal(result.status,'rejected',JSON.stringify(result));assert.equal(result.reason,reason);assert.deepEqual(await state(c),before,'rejection preserves original job');assert.deepEqual((await one('select to_jsonb(p) p from icash_seller_reply_progress p where message_id=$1',[c.m]))?.p,prior,'rejection rolls back progress mutations');assert.deepEqual((await receipt(c)).prior_job,before,'immutable original failure receipt');return result;}
let c=cases.shift();const original=await state(c),screen=await one('select completed_at,result from icash_screening_jobs where id=$1',[c.s]);
const recovered=await recover(c);assert.equal(recovered.status,'recovered');assert.equal(recovered.reason,'original_source_pending');assert.equal(recovered.repeated,false);
const pending=await state(c);assert.equal(pending.state,'pending');assert.equal(pending.outgoing_id,null);assert.equal(pending.provider_id,null);assert.equal(pending.usage,null);assert.equal(pending.reply,null);assert.deepEqual(pending.analysis,original.analysis);
assert.deepEqual((await receipt(c)).prior_job,original);assert.deepEqual(await one('select completed_at,result from icash_screening_jobs where id=$1',[c.s]),screen);
assert.equal((await one("select count(*)::int n from icash_text_messages where account_id=$1 and direction='outgoing'",[c.a])).n,0,'recovery queues no text');
assert.equal((await recover(c)).repeated,true);assert.deepEqual(await state(c),pending,'second recovery does not reset job');
// Continue the existing job through normal prepare/queue/final admission.
const sent=await dispatch(c,pending);assert(!/\$|[0-9]+|guarantee|sent.*contract|booked/.test(sent.body));const after=await state(c),audit=await receipt(c);assert.equal((await recover(c)).repeated,true);assert.deepEqual(await state(c),after,'recovery cannot replay queued work');assert.deepEqual(await receipt(c),audit,'receipt remains immutable on repeat');
assert.equal((await one('select count(*)::int n from icash_offer_authorities where account_id=$1',[c.a])).n,0);
assert.equal((await one('select count(*)::int n from icash_signing_envelopes where account_id=$1',[c.a])).n,0);
for(const mutation of [
 "update icash_text_ai_jobs set provider_id='unknown' where id=$1",
 "update icash_text_ai_jobs set usage='{}' where id=$1",
 "update icash_text_ai_jobs set reply='unknown' where id=$1",
 "update icash_text_ai_jobs set outgoing_id=gen_random_uuid() where id=$1",
 "update icash_text_ai_jobs set updated_at=updated_at+interval '1 second' where id=$1",
 "update icash_text_ai_jobs set analysis=jsonb_set(analysis,'{dialogueAction}','\"cash_offer\"') where id=$1"
]){c=cases.shift();await q(mutation,[c.j.id]);await reject(c,'original_failure_changed');}
for(const mutation of [
 "insert into icash_automation_tickets(account_id,text_ai_job_id) values($2,$1)",
 "insert into icash_operation_spend(operation_key,account_id) values('sms-ai:'||$1,$2)",
 "insert into icash_text_messages(account_id,thread_id,direction,state,body,request_key) select $2,thread_id,'outgoing','failed','original',id from icash_text_ai_jobs where id=$1"
]){c=cases.shift();await q(mutation,[c.j.id,c.a]);await reject(c,'prior_operation_evidence');}
for(const mutation of [
 "update icash_accounts set bot_paused=true where id=$1",
 "update icash_text_threads set manual_only=true where account_id=$1",
 "update icash_text_threads set permission_until=now()-interval '1 second' where account_id=$1",
 "update icash_sms_routes set revision=2 where account_id=$1",
 "update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"hold\"}}' where account_id=$1",
 "insert into icash_text_suppressions select recipient from icash_text_threads where account_id=$1"
]){c=cases.shift();await q(mutation,[c.a]);await reject(c,'current_dialogue_not_admitted');}
c=cases.shift();await incoming(c,'STOP');await reject(c,'newer_conversation');
c=cases.shift();await q("update icash_text_messages set created_at=now()-interval '25 hours' where id=$1",[c.m]);await reject(c,'original_failure_window_changed');
c=cases.shift();await q('update icash_text_messages set event_id=null,provider_id=null where id=$1',[c.m]);await reject(c,'original_failure_window_changed');
c=cases.shift();await q("update icash_screening_jobs set completed_at=now()-interval '48 hours' where id=$1",[c.s]);await reject(c,'original_failure_window_changed');
c=cases.shift();await assert.rejects(rpc('icash_seller_information_private.recover',[c.a,c.m,c.j.id,'0'.repeat(64)]),/Reviewed seller source differs/);assert.equal(await receipt(c),undefined);assert.equal((await state(c)).state,'needs_review');
c=cases.shift();const gate=(await one("select pg_get_functiondef('icash_seller_progress_gate(uuid,uuid)'::regprocedure) def")).def;await pg.exec('create or replace function icash_seller_progress_gate(p_account uuid,p_job uuid) returns boolean language sql as $$select null::boolean$$;');await reject(c,'current_progress_not_admitted');await pg.exec(gate);
assert.equal(cases.length,0);
assert.equal((await one("select has_schema_privilege('service_role','icash_seller_information_private','USAGE') allowed")).allowed,false,'recovery has no service/API access');
assert.equal((await one("select has_function_privilege('service_role','icash_seller_information_private.recover(uuid,uuid,uuid,text)','EXECUTE') allowed")).allowed,false);
await pg.close();console.log('PASS source-bound recovery: immutable prior failure, exact original source, unattempted only, one-use receipt, current controls, NULL gate rejection, normal final admission, no transport or financial authority.');
