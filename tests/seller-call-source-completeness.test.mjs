import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {sellerCallSource} from '../lib/seller-call-source.ts';
import {sellerMemoryInboundTurns} from '../lib/seller-memory.ts';
import {readSellerMemory as readLegacySellerMemory} from './fixtures/seller-memory-pre-raw-reader.ts';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';
import {setup,fixture,migration} from './helpers/seller-call-source-fixture.mjs';
const a=(message,n=1)=>({role:'agent',message,time_in_call_secs:n});
const u=(message,n=2)=>({role:'user',message,time_in_call_secs:n});
globalThis.fetch=async()=>{throw Error('NO NETWORK: fictional original sources');};
const long='Please stop calling. '+('My statement must remain whole. '.repeat(500));
const original=Array.from({length:17},(_,i)=>i===8?u(long,i):i%2?u('Thanks.',i):a('Anything else?',i));
assert.equal(sellerMemoryInboundTurns({transcript:original}).length,16,'reproduce predecessor silently dropping the long refusal');
const source=sellerCallSource({conversation_id:'conv_f',agent_id:'agent_f',status:'done',transcript:original});
assert.equal(JSON.parse(source.rawJson).length,17);assert.equal(JSON.parse(source.rawJson)[8].message,long);
assert.equal(sellerCallSource({transcript:[u('x'.repeat(262144))]}).rawJson,null,'overlimit carries no clipped body');
assert.doesNotThrow(()=>sellerCallSource({metadata:{start_time_unix_secs:1e100},transcript:[]}));
const pg=await PGlite.create();await setup(pg);await pg.exec(migration);
const f=await fixture(pg);
await assert.rejects(f.query("update icash_seller_call_source_private.policy set enabled=true,activated_at=clock_timestamp(),release_sha=null"),/check constraint/);
const disabled=await f.outbound([u('Original inactive completion.')],{state:'waiting'});
await f.query('update public.icash_call_recordings set conversation_id=null where operation_key=(select operation_key from public.icash_live_conversations where id=$1)',[disabled.id]);
await f.rpc('icash_save_live_result_with_source',{p_call:disabled.id,p_result:{transcript:disabled.raw.transcript,summary:'Original inactive fixture',party:'seller'},p_evidence:null});
assert.equal((await f.query('select state from public.icash_live_conversations where id=$1',[disabled.id])).rows[0].state,'complete','disabled source policy preserves original saver behavior');
const legacy=await f.outbound([u('Legacy unknown')],{completedAt:'2020-01-01T00:00:00Z'});
const before=await f.context();assert.equal(before.callSourceVersion,undefined,'disabled policy delegates unchanged');
assert.equal(await legacy.capture(),true);assert.equal((await f.query('select count(*)::int n from icash_seller_call_source_private.sources')).rows[0].n,0,'disabled capture writes nothing');
await f.activate();
const cohort=(await f.query('select account_ids from icash_seller_memory_private.settings')).rows[0].account_ids;
await f.query("update icash_seller_memory_private.settings set account_ids='{}'");
const outside=await f.outbound([u('Original noncohort completion.')],{state:'waiting'});
await f.rpc('icash_save_live_result_with_source',{p_call:outside.id,p_result:{transcript:outside.raw.transcript,summary:'Original noncohort fixture',party:'seller'},p_evidence:null});
assert.equal((await f.query('select state from public.icash_live_conversations where id=$1',[outside.id])).rows[0].state,'complete','noncohort original completion is not stranded');
assert.equal(await outside.capture(),true,'noncohort capture is a no-op');
assert.equal((await f.query('select count(*)::int n from icash_seller_call_source_private.sources')).rows[0].n,0);
await f.query('update icash_seller_memory_private.settings set account_ids=$1',[cohort]);
assert.equal((await f.context()).callSourceComplete,false,'legacy source is not retroactively certified');
assert.equal(await legacy.capture(),true);assert.equal((await f.query('select count(*)::int n from icash_seller_call_source_private.sources')).rows[0].n,0);
const fresh=await f.inbound(original);assert.equal(await fresh.capture(),true);
let c=await f.context();let call=c.conversations.find(x=>x.sourceId==='reception:'+fresh.id);
assert.equal(call.complete,true);assert.equal(call.transcript.length,17);assert.equal(call.transcript[8].message,long);assert.equal(call.sourceCoverage,'verified');
assert.equal(await fresh.capture(),true,'same original capture is idempotent');
assert.equal((await f.query('select count(*)::int n from icash_seller_call_source_private.sources')).rows[0].n,1);
fresh.raw.transcript=[a('Anything else?'),u('Yes, send it.')];assert.equal(await fresh.capture(),true);
c=await f.context();call=c.conversations.find(x=>x.sourceId==='reception:'+fresh.id);assert.equal(call.sourceCoverage,'conflict');assert.equal(call.complete,false);assert.equal(call.transcript[8].message,long,'first original quote remains immutable');
const malformed=await f.outbound({unexpected:'whole source unavailable'},{result:{transcript:{malformed:true}}});
assert.equal(await malformed.capture(),true);c=await f.context();call=c.conversations.find(x=>x.sourceId==='call:'+malformed.id);
assert.equal(call.sourceCoverage,'invalid','retained malformed call is present, never silently filtered out');assert.equal(c.callSourceComplete,false);
const huge=await f.outbound([u('x'.repeat(262144))],{result:{transcript:[]}});assert.equal(await huge.capture(),true);call=(await f.context()).conversations.find(x=>x.sourceId==='call:'+huge.id);assert.equal(call.complete,false);assert.deepEqual(call.transcript,[]);
const unclocked=await f.outbound([{role:'agent',message:'What repairs?'},{role:'user',message:'The roof collapsed. Talk to a person.'}]);unclocked.raw.metadata={};
assert.equal(await unclocked.capture(),true);call=(await f.context()).conversations.find(x=>x.sourceId==='call:'+unclocked.id);assert.equal(call.complete,true);assert.equal((await f.context()).receiptSourceComplete,false,'old receipt readers remain held whenever raw voice exists');assert.equal((await readLegacySellerMemory(f.db,f.binding)).complete,false,'actual stale reader cannot promote raw quotes into qualification');assert.equal(call.startedAt,null);assert.equal(call.transcript[1].seconds,null);assert.match(call.transcript[1].message,/roof collapsed/);
const wrong=await f.inbound([u('Yes.')]);const wrongEvidence={...sellerCallSource(wrong.raw),conversationId:'conv_other'};
assert.equal(await f.rpc('icash_capture_seller_call_source',{p_kind:'inbound',p_source:wrong.id,p_evidence:wrongEvidence}),false);
const tool=await f.outbound([a('Any repairs?',1),{role:'agent',message:null,tool_calls:[{tool_name:'fixture'}]},u('Roof damage.',2)]);assert.equal(await tool.capture(),true);
call=(await f.context()).conversations.find(x=>x.sourceId==='call:'+tool.id);assert.equal(call.complete,true);assert.equal(call.rawTurnCount,3);assert.equal(call.transcript.length,2);assert.deepEqual(call.transcript.map(t=>t.seconds),[1,2],'recognized tool-only rows preserve speech clock/prefix');
const optionalAgent=await f.outbound([{role:'agent',message:'Any repairs?'},u('Roof damage.',2),{role:'agent',message:'Anything else?',time_in_call_secs:null},u('Thanks.',3)]);assert.equal(await optionalAgent.capture(),true);
call=(await f.context()).conversations.find(x=>x.sourceId==='call:'+optionalAgent.id);assert.deepEqual(call.transcript.map(t=>t.seconds),[null,2,null,3],'missing optional agent clocks retain valid user clocks and exact prefix');
for(const transcript of [[a('Any repairs?',2),u('Roof damage.',1)],[a('Any repairs?',1),u('Roof damage.',-1)],[a('Any repairs?',3),{role:'agent',message:'Still there?'},u('Roof damage.',2)],[{role:'agent',message:'Any repairs?',time_in_call_secs:'bad'},u('Roof damage.',2)],[a('Any repairs?',1),{role:'user',message:'Roof damage.',time_in_call_secs:'two'}]]){
 const invalidClock=await f.outbound(transcript);assert.equal(await invalidClock.capture(),true);call=(await f.context()).conversations.find(x=>x.sourceId==='call:'+invalidClock.id);
 assert.equal(call.complete,true);assert(call.transcript.every(t=>t.seconds===null),'invalid source clock never becomes positive fact authority');
}
for(const transcript of [[{role:'user',message:null,tool_calls:[{}]}],[{role:'agent',message:null,tool_calls:[]}],[{role:'unknown',message:'Stop calling'}]]){
 const invalid=await f.outbound(transcript);assert.equal(await invalid.capture(),true);assert.equal((await f.context()).conversations.find(x=>x.sourceId==='call:'+invalid.id).complete,false);
}
const quota=await f.outbound([],{result:{transcript:[],providerFailure:'quota_exceeded',durationSeconds:0}});
Object.assign(quota.raw,{status:'failed',has_user_audio:false,has_response_audio:false});Object.assign(quota.raw.metadata,{call_duration_secs:0,error:{reason:'[quota_exceeded] fixture'}});
assert.equal(await quota.capture(),true);assert.equal((await f.context()).conversations.find(x=>x.sourceId==='call:'+quota.id).complete,true,'verified empty provider quota refusal adds no invented speech or permanent coverage gap');
const pending=await f.outbound([a('Anything else?'),u('Thanks.')],{state:'waiting'});
await pg.exec("create function icash_seller_call_source_private.fail_fixture() returns trigger language plpgsql as $$begin raise exception 'fixture failure';end $$;create trigger fixture_fail before insert on icash_seller_call_source_private.sources for each row execute function icash_seller_call_source_private.fail_fixture()");
await assert.rejects(f.rpc('icash_save_live_result_with_source',{p_call:pending.id,p_result:{transcript:pending.raw.transcript,summary:'Original fixture',party:'seller'},p_evidence:sellerCallSource(pending.raw)}),/fixture failure/);
assert.equal((await f.query('select state from public.icash_live_conversations where id=$1',[pending.id])).rows[0].state,'waiting','capture failure rolls completion back into original reconciliation');
await f.query('drop trigger fixture_fail on icash_seller_call_source_private.sources');
await f.rpc('icash_save_live_result_with_source',{p_call:pending.id,p_result:{transcript:pending.raw.transcript,summary:'Original fixture',party:'seller'},p_evidence:sellerCallSource(pending.raw)});
assert.equal((await f.query('select state from public.icash_live_conversations where id=$1',[pending.id])).rows[0].state,'complete');
assert.equal((await f.context()).conversations.find(x=>x.sourceId==='call:'+pending.id).complete,true);
await assert.rejects(f.query('delete from icash_seller_call_source_private.sources'),/immutable/);
await assert.rejects(f.query('truncate icash_seller_call_source_private.conflicts'),/immutable/);
await assert.rejects(f.query("update icash_seller_call_source_private.policy set activated_at=now()-interval '1 day'"),/Fresh original/);
const grants=await f.query("select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='icash_seller_call_source_private' and grantee in ('anon','authenticated','service_role')");assert.deepEqual(grants.rows,[]);
for(const [label,transcript,unclocked] of [
 ['unknown clocks',qualifiedSellerTurns,true],
 ['persistent human request',[{role:'user',message:'I need to speak to a human before proceeding.'},...qualifiedSellerTurns].map((t,i)=>({...t,time_in_call_secs:i})),false],
]){
 const isolated=await fixture(pg);const empty=await isolated.context();assert.equal(empty.receiptSourceComplete,true,'no-calls legacy completeness is unchanged');
 const original=await isolated.outbound(transcript);if(unclocked)original.raw.metadata={};assert.equal(await original.capture(),true);
 const canonical=await isolated.context();assert.equal(canonical.callSourceComplete,true,label+' is whole-content complete');assert(Number.isFinite(Date.parse(canonical.callSourceCutover)));
 const recomputed=(await isolated.query("select encode(sha256(convert_to(jsonb_build_object('conversations',$1::jsonb,'callSourceVersion','seller-call-source-v1','callSourceComplete',$2::boolean,'cutover',$3::timestamptz)::text,'UTF8')),'hex') hash",[canonical.conversations,canonical.callSourceComplete,canonical.callSourceCutover])).rows[0].hash;assert.equal(canonical.fingerprint,recomputed,'atomic admission can recompute exact raw fingerprint from typed public fields');assert.equal(canonical.receiptSourceComplete,false,label+' holds stale workers explicitly');
 const old=await readLegacySellerMemory(isolated.db,isolated.binding);assert.equal(old.complete,false,label+' cannot become old-worker authority');assert.equal(old.state.qualification.ready,false);
}
const functions=await f.query("select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl from pg_proc p where p.oid in ('public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure,'public.icash_seller_memory_before_call_source(uuid,uuid,text)'::regprocedure,'public.icash_capture_seller_call_source(text,uuid,jsonb)'::regprocedure,'public.icash_save_live_result_with_source(uuid,jsonb,jsonb)'::regprocedure,'icash_seller_call_source_private.turn_kind(jsonb)'::regprocedure,'icash_seller_call_source_private.policy_guard()'::regprocedure,'icash_seller_call_source_private.immutable()'::regprocedure) order by signature");
console.log(JSON.stringify(functions.rows));await pg.close();
assert.equal(migration,readFileSync(new URL('../supabase/migrations/20261117035504_seller_call_source_completeness.sql',import.meta.url),'utf8'));
console.log('seller-call-source-completeness passed');
