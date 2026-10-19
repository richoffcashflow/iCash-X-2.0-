import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const baseline=read('tests/fixtures/voice-queue-before-candidate-fence.sql');
const sql=read('config/voice-queue-candidate-fence.sql');
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=uid(1),other=uid(2);
try{
// Small isolated schema. The exact production queue is exercised; the expensive
// external eligibility gate is instrumented so no provider work is possible.
await db.exec(`
create role anon;create role authenticated;create role service_role;
create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
create table icash_accounts(id uuid primary key,bot_paused bool default false);
create table icash_voice_configs(account_id uuid primary key,enabled bool default true,reviewed_until timestamptz default now()+interval '1 day');
create table icash_screening_jobs(id uuid primary key,account_id uuid,state text default 'complete',result jsonb default '{"financialCheck":{"status":"eligible"}}');
create table icash_dnc_verification_receipts(id uuid primary key,evidence_kind text default 'national_provider_observation');
create table icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,channel text default 'voice',phone text,contact_key text,dnc_receipt_id uuid,eligibility_until timestamptz default now()+interval '1 day',created_at timestamptz default now(),revoked_at timestamptz);
create index contact_scope on icash_operational_contacts(account_id,screening_id,channel);
create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,phone text,contact_key text);
create table icash_outreach_campaigns(account_id uuid primary key,mode text);
create table icash_voice_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,permission_id uuid,operational_contact_id uuid,callback_id uuid,due_at timestamptz default now(),state text default 'ready',outcome text);
create unique index first_once on icash_voice_jobs(operational_contact_id) where callback_id is null;
create unique index callback_once on icash_voice_jobs(callback_id) where callback_id is not null;
create view icash_voice_contact_targets as select id,account_id,screening_id,contact_key from icash_operational_contacts union all select id,account_id,screening_id,contact_key from icash_contact_permissions;
create table icash_live_conversations(id uuid primary key,account_id uuid,state text,party text,result jsonb,contact_key text);
create table icash_live_callbacks(id uuid primary key,account_id uuid,conversation_id uuid,screening_id uuid,state text,due_at timestamptz);
create table fixture_checks(contact_id uuid primary key,account_id uuid,allowed boolean);
create table fixture_calls(contact_id uuid);
create function icash_prepare_operational_contacts() returns int language sql as $$select 0$$;
create function icash_queue_voice_jobs_before_operational() returns void language plpgsql as $$begin end$$;
create function icash_outreach_voice_current(uuid) returns bool language sql stable set search_path=public as $$select exists(select 1 from icash_accounts where id=$1 and not bot_paused)$$;
create function icash_operational_contact_current(uuid,uuid,text,boolean) returns bool language plpgsql set search_path=public as $$begin insert into fixture_calls values($2);return exists(select 1 from fixture_checks where contact_id=$2 and account_id=$1 and allowed) and $3='voice' and $4=false;end$$;
`);
await q('insert into icash_accounts(id) values($1),($2)',[account,other]);
await q('insert into icash_voice_configs(account_id) values($1),($2)',[account,other]);
await db.exec(baseline);
await db.exec('revoke all on function icash_queue_voice_jobs() from public,anon,authenticated;grant execute on function icash_queue_voice_jobs() to service_role;');
const add=async(n,{a=account,allowed=true,age=0,queued=false}={})=>{
 const id=uid(n),phone='+1214'+String(n).padStart(7,'0');
 await q('insert into icash_screening_jobs(id,account_id) values($1,$2)',[id,a]);
 await q('insert into icash_dnc_verification_receipts(id) values($1)',[id]);
 await q("insert into icash_operational_contacts(id,account_id,screening_id,phone,contact_key,dnc_receipt_id,created_at) values($1,$2,$1,$3,$3,$1,now()-$4*interval '1 second')",[id,a,phone,age]);
 await q('insert into fixture_checks values($1,$2,$3)',[id,a,allowed]);
 if(queued)await q("insert into icash_voice_jobs(account_id,operational_contact_id,state,outcome) values($1,$2,'held','provider_outcome_unknown_no_retry')",[a,id]);
 return id;
};
// A realistic accumulated queue: existing unknown jobs must never be revalidated
// or reset just to discover whether a new first call is needed.
for(let n=100;n<500;n++)await add(n,{queued:true,age:1000});
const fresh=await add(1000);
await db.exec('analyze;');
await q('select icash_queue_voice_jobs()');
const before=Number(await v('select count(*) from fixture_calls'));
await q('delete from icash_voice_jobs where operational_contact_id=$1',[fresh]);await db.exec('truncate fixture_calls');
const validator=await v("select pg_get_functiondef('icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure)");
const existing=await v("select md5(string_agg(id::text||':'||state||':'||outcome,',' order by id)) from icash_voice_jobs");
await db.exec(sql);
assert.equal(await v("select pg_get_functiondef('icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure)"),validator,'validator stays byte-for-byte unchanged');
await q('select icash_queue_voice_jobs()');
const after=Number(await v('select count(*) from fixture_calls'));
assert.equal(after,2,'only the new candidate gets admission and final recheck');
assert(before>after,'exact prior queue unnecessarily validates already queued contacts');
assert.equal(await v("select md5(string_agg(id::text||':'||state||':'||outcome,',' order by id)) from icash_voice_jobs where operational_contact_id<>$1",[fresh]),existing,'unknown jobs unchanged');
await db.exec('truncate fixture_calls');await q('select icash_queue_voice_jobs()');
assert.equal(Number(await v('select count(*) from fixture_calls')),0,'warm repeated queue has zero expensive validations');
// Invalid earlier rows must not consume the 100-row batch. The valid later
// account must still be considered; no LIMIT lives inside the cheap CTE.
for(let n=2000;n<2150;n++)await add(n,{allowed:false,age:500});
const later=await add(2200,{a:other});
await q('select icash_queue_voice_jobs()');
assert.equal(Number(await v('select count(*) from icash_voice_jobs where operational_contact_id=$1',[later])),1,'later eligible account not starved by 150 denied contacts');
const unknown=await v("select count(*) from icash_voice_jobs where outcome='provider_outcome_unknown_no_retry'");assert.equal(Number(unknown),400);
// Callback candidate filtering keeps the same receipt/contact binding and order.
await db.exec('update fixture_checks set allowed=true where contact_id in (select operational_contact_id from icash_voice_jobs);');
const callback=async(n,{allowed=true,existing=false,match=true}={})=>{
 const id=await add(n,{allowed,queued:true});
 await q("insert into icash_live_conversations values($1,$2,'complete','seller',jsonb_build_object('callbackDueAt',now()),$3)",[id,account,'+1214'+String(n).padStart(7,'0')]);
 await q("insert into icash_live_callbacks values($1,$2,$1,$1,'pending_dispatch_review',now()+$3*interval '1 second')",[id,account,match?0:1]);
 if(existing)await q("insert into icash_voice_jobs(account_id,operational_contact_id,callback_id,state,outcome) values($1,$2,$2,'held','provider_outcome_unknown_no_retry')",[account,id]);
 return id;
};
await q('begin');
for(let n=3000;n<3120;n++)await callback(n,{allowed:false});
const blockedCallback=await callback(3200,{existing:true}),goodCallback=await callback(3201),mismatch=await callback(3202,{match:false});
await db.exec('truncate fixture_calls');await q('select icash_queue_voice_jobs()');
assert.equal(Number(await v('select count(*) from fixture_calls where contact_id=$1',[blockedCallback])),0,'already queued callback incurs no validator call');
assert.equal(Number(await v('select count(*) from icash_voice_jobs where callback_id=$1',[goodCallback])),1,'late valid callback survives 120 denied earlier rows');
assert.equal(Number(await v('select count(*) from icash_voice_jobs where callback_id=$1',[mismatch])),0,'mismatched callback receipt still fails');
await q('rollback');
// Cheap exclusions remain before validation and cannot change account state.
for(const change of ["update icash_accounts set bot_paused=true",'update icash_voice_configs set enabled=false',"update icash_screening_jobs set result='{}'", "insert into icash_outreach_campaigns values('"+account+"','sms_inbound'),('"+other+"','sms_inbound')"]){
 await q('begin');await db.exec(change+';truncate fixture_calls');await q('select icash_queue_voice_jobs()');assert.equal(Number(await v('select count(*) from fixture_calls')),0,change);await q('rollback');
}
for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'icash_queue_voice_jobs()','execute')",[role]),false);
assert.equal(await v("select has_function_privilege('service_role','icash_queue_voice_jobs()','execute')"),true);
await assert.rejects(db.exec(sql),/Voice queue candidate prerequisite changed/);await db.exec('rollback');
assert.equal(sql,read('supabase/migrations/20261019183117_voice_queue_candidate_fence.sql'));
console.log(`Voice queue fence: exact baseline ${before} validations -> ${after}; warm queue 0. Existing holds, callbacks, pre-limit eligibility, account/Pause/config gates, order and private grants preserved. Local synthetic fixtures only.`);
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await db.close();}
