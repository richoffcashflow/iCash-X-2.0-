import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import * as f from './helpers/financial-prequalification-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite(),q=(sql,args=[])=>db.query(sql,args),val=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const id=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const patch=read('config/targeting-call-exposure-clocks.sql');
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(f.setupSql+f.migration+f.seedSql+f.activateSql);
 await db.exec(`create table icash_call_recordings(account_id uuid,screening_id uuid,operation_key text,party text,call_sid text,created_at timestamptz);
  create table icash_voice_jobs(account_id uuid,operation_key text,provider_call_sid text,permission_id uuid,operational_contact_id uuid,created_at timestamptz);
  create table icash_operational_contacts(id uuid,account_id uuid,screening_id uuid);
  create table icash_contact_permissions(id uuid,account_id uuid,screening_id uuid,party text);
  create function icash_screening_wrong_number(uuid,uuid,timestamptz) returns boolean language sql as $$select false$$;`);
 // Exact production definition includes both later financial-query and
 // carrier-only extensions; this is not an isolated imitation of its WHERE.
 await db.exec(read('tests/fixtures/targeting-call-exposure-before.sql'));
 assert.equal(await val("select md5(pg_get_functiondef('icash_targeting_learning_evidence(uuid,text,uuid)'::regprocedure))"),'dccbe762e4f16bb2164a88df58ae3c83');
 await db.exec(`update icash_research_private.targeting_settings set learning_started_at=now()-interval '100 days';
  update icash_research_private.targeting_experiments set learning_started_at=now()-interval '100 days';
  update icash_integration_checks set result=jsonb_set(result,'{filters}',result->'filters'||'[{"filter_id":"is_vacant_home","type":"BOOLEAN","allowed_operators":[],"is_premium_filter":false}]');`);
 await q(`insert into icash_discovery_filter_pages(operation_key,account_id,revision,sequence,zip,plan,state,created_at)
  values('clock-page',$1,$2,1,'75217',$3,'complete',now()-interval '10 days')`,[f.account,f.revision,f.plan]);
 await q(`insert into icash_discovery_inventory_receipts(operation_key,account_id,per_page,query_policy,property_ids)
  values('clock-page',$1,5,$2,'{}')`,[f.account,f.policy]);
 await q(`insert into icash_operation_spend(operation_key,account_id,state,charged_cents,actual_micros,created_at)
  values('clock-page',$1,'settled',100,500000,now()-interval '10 days')`,[f.account]);
 for(const n of [1,2]){
  await q(`insert into icash_screening_jobs(id,account_id,state,result,snapshot) values($1,$2,'complete','{"financialCheck":{"status":"eligible"}}','{}')`,[id(n),f.account]);
  await q('insert into icash_discovery_filter_attribution values($1,$2,\'clock-page\')',[id(n),f.account]);
  await q(`insert into icash_operation_spend(operation_key,account_id,state,charged_cents,actual_micros,created_at,dispatched_at)
   values($1,$2,'settled',20,100000,now()-interval '5 days',now()-interval '4 days')`,[`voice:clock-${n}`,f.account]);
 }
 // Normal real order: operation is created, dispatch occurs, recording and AI
 // conversation rows are then registered. One case has no AI conversation.
 await q(`insert into icash_live_conversations(id,account_id,screening_id,party,conversation_id,operation_key,state,created_at,completed_at,result)
  values($1,$2,$3,'seller','provider-conversation','voice:clock-1','complete',now()-interval '4 days'+interval '2 seconds',now()-interval '4 days'+interval '1 minute','{}')`,[id(11),f.account,id(1)]);
 await q(`insert into icash_call_recordings values($1,$2,'voice:clock-2','seller','CA_fixture',now()-interval '4 days'+interval '1 second')`,[f.account,id(2)]);
 const experiment=await val('select id from icash_research_private.targeting_experiments where enabled limit 1');
 const evidence=()=>val("select icash_targeting_learning_evidence($1,'75217',$2)",[f.account,experiment]);
 const old=await evidence();assert.equal(old.baseline.attempts,0,'Both valid post-dispatch registrations are excluded by the old function');
 const sourceBefore=await val(`select jsonb_build_object('operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o),
  'calls',(select jsonb_agg(to_jsonb(c)) from icash_live_conversations c),'recordings',(select jsonb_agg(to_jsonb(r)) from icash_call_recordings r))`);
 const aclBefore=await val("select proacl::text from pg_proc where oid='icash_targeting_learning_evidence(uuid,text,uuid)'::regprocedure");
 await db.exec(patch);await db.exec(patch);
 let after=await evidence();assert.equal(after.baseline.attempts,2);assert.equal(after.baseline.matureAttempts,2);
 assert.equal(after.baseline.costCents,old.baseline.costCents);assert.equal(after.baseline.interested,0,'An attempt is not selling interest');
 assert.equal(await val("select proacl::text from pg_proc where oid='icash_targeting_learning_evidence(uuid,text,uuid)'::regprocedure"),aclBefore);
 assert.equal(await val("select md5(pg_get_functiondef('icash_targeting_learning_evidence(uuid,text,uuid)'::regprocedure))"),'1c912fbca63d0e2c22c59e58c22ecc51');
 assert.deepEqual(await val(`select jsonb_build_object('operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o),
  'calls',(select jsonb_agg(to_jsonb(c)) from icash_live_conversations c),'recordings',(select jsonb_agg(to_jsonb(r)) from icash_call_recordings r))`),sourceBefore);
 const scenario=async(statement,args,check)=>{await db.exec('begin');try{if(args.length)await q(statement,args);else await db.exec(statement);await check(await evidence());}finally{await db.exec('rollback');}};
 for(const change of ["dispatched_at=null","dispatched_at=now()+interval '1 day'","dispatched_at=created_at-interval '1 second'","dispatched_at=now()-interval '11 days',created_at=now()-interval '12 days'","created_at=null"]){
  await scenario(`update icash_operation_spend set ${change} where operation_key like 'voice:clock-%'`,[],r=>assert.equal(r.baseline.attempts,0,change));
 }
 await scenario("update icash_operation_spend set account_id=$1 where operation_key like 'voice:clock-%'",[f.other],r=>assert.equal(r.baseline.attempts,0));
 await scenario("update icash_live_conversations set party='buyer';update icash_call_recordings set party='buyer'",[],r=>assert.equal(r.baseline.attempts,0));
 await scenario("with changed as (update icash_live_conversations set screening_id=$1 returning id) update icash_call_recordings set screening_id=$1",[id(99)],r=>assert.equal(r.baseline.attempts,0));
 await scenario("update icash_live_conversations set conversation_id='';update icash_call_recordings set call_sid=''",[],r=>assert.equal(r.baseline.attempts,0));
 await scenario("update icash_discovery_inventory_receipts set query_policy=jsonb_set(query_policy,'{tier}','1')",[],r=>assert.equal(r.baseline.attempts,0));
 await scenario("update icash_operation_spend set dispatched_at=now()-interval '2 days' where operation_key like 'voice:clock-%'",[],r=>{assert.equal(r.baseline.attempts,2);assert.equal(r.baseline.matureAttempts,0);});
 const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(p=>p.endsWith('_targeting_call_exposure_clocks.sql'));
 assert.equal(migrations.length,1);assert.equal(read('supabase/migrations/'+migrations[0]),patch);
 console.log('Targeting call exposure clocks: actual production SQL reproduces post-dispatch registration loss; original operation clocks, identity/query bounds, maturity, costs and source receipts preserved.');
}finally{await db.close();}
