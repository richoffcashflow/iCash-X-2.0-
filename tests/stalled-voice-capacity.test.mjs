// Real production function definitions in isolated PostgreSQL; no provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/stalled-voice-capacity.sql');
assert.equal(sql,read('supabase/migrations/20261025230100_stalled_voice_capacity.sql'));
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=id(1),rate=id(2),ac='AC'+'a'.repeat(32),call='CA'+'b'.repeat(32);
const sweep=async()=>{await db.exec("update icash_recording_private.capacity_sweep set next_check_at=now()-interval '1 second'");return one('select icash_quarantine_stalled_voice_slots()');};
const slots=()=>one('select count(distinct operation_key)::int from icash_active_voice_slots()');
const capacity=contact=>one("select icash_voice_capacity_available($1,'agent_fixture','voice:new',$2,false)",[account,contact]);
const trans=(n,action,payload={})=>one("select icash_transition_call_recording($1,$2,$3,'consent_pending',$4,$5::jsonb)",[id(n),account,'voice:'+id(n),action,JSON.stringify(payload)]);
const snapshot=()=>one(`select jsonb_build_object('operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o),
 'jobs',(select jsonb_agg(to_jsonb(j) order by id) from icash_voice_jobs j),'tickets',(select jsonb_agg(to_jsonb(t) order by voice_job_id) from icash_automation_tickets t),
 'recordings',(select jsonb_agg(to_jsonb(r) order by id) from icash_call_recordings r),'budget',(select to_jsonb(b) from icash_operating_budget b),'wallet',(select to_jsonb(w) from icash_wallets w))`);
async function add(n,{recorded=true,fresh=false,state='held'}={}){
 const age=fresh?'1 minute':'1 hour';
 await q("insert into icash_voice_contact_targets(id,account_id,contact_key) values($1,$2,$3)",[id(n),account,'contact-'+n]);
 await q(`insert into icash_operation_spend(operation_key,account_id,rate_id,state,reserved_micros,charge_cap_cents,dispatched_at,permission_until)
 values($1,$2,$3,'dispatched',1800000,256,now()-interval '${age}',now()+interval '1 day')`,['voice:'+id(n),account,rate]);
 await q(`insert into icash_voice_jobs(id,account_id,operational_contact_id,operation_key,state,outcome,updated_at)
 values($1,$2,$1,$3,$4,'provider_outcome_unknown_no_retry',now()-interval '${age}')`,[id(n),account,'voice:'+id(n),state]);
 await q(`insert into icash_automation_tickets(id,account_id,voice_job_id,kind,state,outcome,created_at,expires_at,completed_at)
 values($1,$2,$1,'voice_dispatch',$3,$4,now()-interval '${age}'-interval '1 minute',now()-interval '${age}'+interval '2 minutes',$5::timestamptz)`,[id(n),account,state==='dispatching'?'consumed':'held',state==='dispatching'?null:'provider_outcome_unknown_no_retry',state==='dispatching'?null:new Date(Date.now()-(fresh?30000:3570000)).toISOString()]);
 if(recorded)await q(`insert into icash_call_recordings(id,account_id,operation_key,voice_job_id,agent_id,contact_key,entry_policy,state,created_at,consent_deadline_at,dial_claimed_at,max_total_seconds,provider_account_sid,from_phone,to_phone,nonce_hash,row_version)
 values($1,$2,$3,$1,'agent_fixture',$4,'direct_recorded_v1','consent_pending',now()-interval '${age}',now()-interval '${age}'+interval '2 minutes',now()-interval '${age}'+interval '5 seconds',600,$5,'+15555550101','+15555550102',$6,2)`,[id(n),account,'voice:'+id(n),'contact-'+n,ac,'c'.repeat(64)]);
}
try{
 await db.exec(read('tests/fixtures/stalled-voice-capacity-schema.sql'));
 await db.exec(read('tests/fixtures/stalled-voice-capacity-before.sql'));
 await db.exec(`insert into icash_accounts values('${account}',false);insert into icash_voice_configs(account_id,agent_id) values('${account}','agent_fixture');
 insert into icash_wallets values('${account}',30000,2048);insert into icash_operating_budget values(1,14400000,99,true,null);
 insert into icash_operation_rates values('${rate}','seller_call',600,977);insert into icash_voice_capacity_policy values(1,10,now());
 insert into icash_voice_agent_capacity values('agent_fixture',10,now());`);
 for(let n=10;n<18;n++)await add(n,{recorded:n!==10,state:n===11?'dispatching':'held'});
 assert.equal(await slots(),8);assert.equal(await capacity('unrelated'),false);
 const before=await snapshot();await db.exec(sql);
 assert.equal(await slots(),8,'Installation alone preserves every hold');
 assert.equal(await one('select icash_quarantine_stalled_voice_slots()'),8);
 assert.equal(await slots(),0);assert.equal(await capacity('unrelated'),true);
 assert.equal(await one('select icash_outgoing_voice_capacity_open()'),true);
 assert.deepEqual(await snapshot(),before,'Capacity isolation never alters money, jobs, capabilities or provider history');
 assert.equal(await one('select icash_quarantine_stalled_voice_slots()'),0,'Automatic sweep is throttled');
 assert.equal(await sweep(),0,'Repeated maintenance is idempotent');
 for(let n=10;n<18;n++)assert.equal(await capacity('contact-'+n),false,'Same recipient stays held');
 for(const action of ['claim_dial','consent','notice_continue','authorize_recording','claim_start'])assert.equal(await trans(12,action),null,'Quarantined call cannot restart: '+action);
 // A canonical late binding is still saved and immediately restores occupancy.
 assert(await trans(12,'bind_call',{callSid:call,providerAccountSid:ac,fromPhone:'+15555550101',toPhone:'+15555550102'}));
 assert.equal(await slots(),1);assert.equal(await trans(12,'authorize_recording'),null);
 await q("insert into icash_recorded_gate_terminal_receipts values($1,$2,$3,'{\"status\":\"completed\"}')",[id(12),account,call]);
 assert.equal(await slots(),0,'Original terminal receipts still release a now-bound call');
 assert.equal(await capacity('contact-12'),true,'An original terminal receipt can end the recipient capacity hold without permitting this old operation to restart');
 // Independent reasons to preserve active capacity.
 for(const [n,change] of [[20,"call_sid='"+call+"'"],[21,"recording_authorized_at=now()"],[22,"start_claimed_at=now()"],[23,"conversation_id='conv_live'"],[24,"provider_started_at=now()"],[25,"consent_deadline_at=now()+interval '1 minute'"]]){
  await add(n);await q('update icash_call_recordings set '+change+' where id=$1',[id(n)]);
 }
 await add(26,{fresh:true});await add(27,{recorded:false});await q("update icash_automation_tickets set completed_at=null where voice_job_id=$1",[id(27)]);
 await add(28);await q("update icash_automation_tickets set expires_at=now()+interval '1 minute' where voice_job_id=$1",[id(28)]);
 await add(29);await q("insert into icash_live_conversations(operation_key,account_id,state) values($1,$2,'complete')",['voice:'+id(29),account]);
 await add(30);await q("update icash_call_recordings set account_id=$1 where id=$2",[id(99),id(30)]);
 assert.equal(await sweep(),0,'Fresh, active, wrong-bound or unfinished legacy attempts retain capacity');
 await db.exec('begin');
 await add(40);await db.exec("update icash_recording_private.capacity_sweep set next_check_at=now()-interval '1 second'");
 assert.deepEqual(await one('select icash_next_automation()'),{next:'unrelated_work'});
 assert.equal(await one('select count(*)::int from icash_recording_private.capacity_quarantines where voice_job_id=$1',[id(40)]),1,'Regular scheduler automatically isolates a later stalled attempt');
 await db.exec('rollback');
 const policy={version:'required-audio-30d-speech-v1',retentionDays:30,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,recordingAllowanceMicros:31000,speechGatherMicros:20000,estimate:true};
 const context={fromPhone:'+15555550101',branchId:'agtbrch_fixture',versionId:'agtvrsn_fixture',maxTotalSeconds:600};
 assert.equal(await one('select icash_create_direct_recorded_call($1,$2,$3,null,$4,$4,\'fixture\',$5::jsonb,$6::jsonb)',[account,'voice:'+id(10),ac,'c'.repeat(64),JSON.stringify(policy),JSON.stringify(context)]),null,'Legacy unknown operation cannot create a new recording after quarantine');
 await db.exec('begin');
 await db.exec("update icash_call_recordings set call_ended_at=now();update icash_voice_jobs set state='complete';update icash_live_conversations set state='complete';");
 for(let n=60;n<68;n++)await add(n,{fresh:true});
 assert.equal(await one('select icash_outgoing_voice_capacity_open()'),false,'Eight outgoing calls preserve the inbound reserve');
 assert.equal(await one("select icash_voice_capacity_available($1,'agent_fixture','incoming:new','incoming-contact',true)",[account]),true);
 for(let n=70;n<72;n++)await q("insert into icash_recorded_reception_private.sessions values($1,$2,'agent_fixture',$3,null)",['recorded-reception:'+n,account,'incoming-'+n]);
 assert.equal(await one("select icash_voice_capacity_available($1,'agent_fixture','incoming:new','incoming-contact',true)",[account]),false,'Ten total calls retain the provider limit');
 await db.exec('rollback');
 // Ineligible older rows cannot permanently starve the next recoverable attempt.
 await db.exec('begin');
 await q("insert into icash_operation_rates values($1,'buyer_call',600,977)",[id(3)]);
 for(let n=80;n<101;n++){await add(n);await q('update icash_operation_spend set rate_id=$1 where operation_key=$2',[id(3),'voice:'+id(n)]);}
 await add(101);await db.exec('update icash_recording_private.capacity_sweep set last_scanned_at=null,last_scanned_job=null');
 assert.equal(await sweep(),0);assert.equal(await sweep(),1,'Bounded cursor passes older ineligible rows');
 await db.exec('rollback');
 // A maintenance failure rolls back its own changes and leaves other work usable.
 await db.exec('begin');await add(110);
 await db.exec(`update icash_recording_private.capacity_sweep set next_check_at=now()-interval '1 second',last_scanned_at=null,last_scanned_job=null;
 create function fixture_sweep_failure() returns trigger language plpgsql as $$begin raise exception 'fixture failure';end$$;
 create trigger fixture_sweep_failure before insert on icash_recording_private.capacity_quarantines for each row execute function fixture_sweep_failure();`);
 assert.deepEqual(await one('select icash_next_automation()'),{next:'unrelated_work'});
 assert.equal(await one('select count(*)::int from icash_recording_private.capacity_quarantines where voice_job_id=$1',[id(110)]),0);
 await db.exec('rollback');
 for(const role of ['anon','authenticated','service_role']){
  for(const fn of ['icash_quarantine_stalled_voice_slots(integer)','icash_voice_contact_holds()','icash_voice_capacity_available(uuid,text,text,text,boolean)'])
   assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,fn]),role==='service_role');
  for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await one('select has_table_privilege($1,\'icash_recording_private.capacity_quarantines\',$2)',[role,privilege]),false);
 }
 await assert.rejects(()=>db.exec('delete from icash_recording_private.capacity_quarantines'));
 await assert.rejects(()=>db.exec('truncate icash_recording_private.capacity_quarantines'));
 console.log('Stalled voice capacity: automatic isolation, unchanged money/recipient/retry holds, late receipts, live-call exclusions and private immutable audit passed.');
}finally{await db.close();}
