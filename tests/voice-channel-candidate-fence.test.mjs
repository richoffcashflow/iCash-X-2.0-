import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/voice-channel-candidate-fence.sql');
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=uid(1),other=uid(2),disabled=uid(3),unknown=uid(4);
const part=label=>sql.match(new RegExp(`text:=\\$${label}\\$([\\s\\S]*?)\\$${label}\\$`))[1];
const inner=part('inner'),newInner=part('new_inner'),outer=part('outer'),newOuter=part('new_outer');
try{
 await db.exec(read('tests/fixtures/voice-channel-candidate-schema.sql'));
 for(const [id,enabled] of [[account,true],[other,true],[disabled,false],[unknown,null]]){
  await q('insert into icash_accounts(id) values($1)',[id]);
  await q('insert into icash_voice_configs(account_id) values($1)',[id]);
  await q('insert into fixture_channels values($1,$2)',[id,enabled]);
 }
 await db.exec(read('tests/fixtures/voice-queue-before-candidate-fence.sql'));
 await db.exec(read('config/voice-queue-candidate-fence.sql'));
 await db.exec(read('config/voice-queue-prior-route-scan.sql'));
 await db.exec('revoke all on function icash_queue_voice_jobs() from public,anon,authenticated;grant execute on function icash_queue_voice_jobs() to service_role;');
 const original=await v("select pg_get_functiondef('icash_queue_voice_jobs()'::regprocedure)");
 const unchanged=await v("select jsonb_object_agg(oid::regprocedure::text,pg_get_functiondef(oid)) from pg_proc where proname in ('icash_outreach_voice_current','icash_operational_contact_current','icash_prepare_operational_contacts','icash_queue_voice_jobs_before_operational')");
 const expected=original.replace(inner,newInner).replace(outer,newOuter);
 const selectFirst=definition=>definition.match(/for c in ([\s\S]*?)\n loop/)[1];
 const oldSelect=selectFirst(original),newSelect=selectFirst(expected);
 const visits=()=>v("select case when is_called then last_value else 0 end from fixture_channel_visits");
 const reset=()=>db.exec("select setval('fixture_channel_visits',1,false);truncate fixture_calls;");
 const add=async(n,{a=account,allowed=true,age=0,queued=false,state='held'}={})=>{
  const id=uid(n),phone='+1214'+String(n).padStart(7,'0');
  await q('insert into icash_screening_jobs(id,account_id) values($1,$2)',[id,a]);
  await q('insert into icash_dnc_verification_receipts(id) values($1)',[id]);
  await q("insert into icash_operational_contacts(id,account_id,screening_id,phone,contact_key,dnc_receipt_id,created_at) values($1,$2,$1,$3,$3,$1,now()-$4*interval '1 second')",[id,a,phone,age]);
  await q('insert into fixture_checks values($1,$2,$3)',[id,a,allowed]);
  if(queued)await q("insert into icash_voice_jobs(account_id,operational_contact_id,state,outcome) values($1,$2,$3,'provider_outcome_unknown_no_retry')",[a,id,state]);
  return id;
 };
 for(let n=100;n<300;n++)await add(n,{queued:true,age:1000,state:['ready','held','cancelled','failed','complete','issued'][n%6]});
 await db.exec('analyze');
 await reset();assert.deepEqual((await q(oldSelect)).rows,[]);const oldVisits=Number(await visits());
 await reset();assert.deepEqual((await q(newSelect)).rows,[]);const newVisits=Number(await visits());
 assert(oldVisits>=200,`existing selector checks queued contacts: ${oldVisits}`);
 assert.equal(newVisits,0,'pruned contacts do not check account channels');
 const priorState=await v("select md5(string_agg(id::text||':'||state||':'||outcome,',' order by id)) from icash_voice_jobs");
 const positive=await add(1000),otherPositive=await add(1001,{a:other});
 const disabledId=await add(1002,{a:disabled}),nullId=await add(1003,{a:unknown});
 const invalid=await add(1004,{allowed:false}),nullKey=await add(1005,{queued:true});
 await q('update icash_operational_contacts set contact_key=null where id=$1',[nullKey]);
 // Moving a stable predicate across an unlimited materialization boundary must
 // preserve positive, negative, NULL, tenant and prior-route SQL semantics.
 for(const [label,change,args] of [
  ['baseline',null,[]],
  ['channel missing','delete from fixture_channels where account_id=$1',[other]],
  ['account paused','update icash_accounts set bot_paused=true where id=$1',[other]],
  ['SMS only','insert into icash_outreach_campaigns values($1,\'sms_inbound\')',[other]],
  ['NULL channel','update icash_operational_contacts set channel=null where id=$1',[otherPositive]],
  ['expired review','update icash_voice_configs set reviewed_until=now()-interval \'1 second\' where account_id=$1',[other]],
  ['revoked contact','update icash_operational_contacts set revoked_at=now() where id=$1',[otherPositive]],
  ['expired contact','update icash_operational_contacts set eligibility_until=now()-interval \'1 second\' where id=$1',[otherPositive]],
  ['ineligible property','update icash_screening_jobs set result=\'{}\' where id=$1',[otherPositive]],
 ]){
  await q('begin');if(change)await q(change,args);
  await reset();const oldIds=(await q(oldSelect)).rows.map(r=>r.id);
  await reset();const newIds=(await q(newSelect)).rows.map(r=>r.id);
  assert.deepEqual(newIds,oldIds,label);
  assert(!newIds.includes(disabledId)&&!newIds.includes(nullId)&&!newIds.includes(invalid),label);
  assert.equal(Number(await v('select count(*) from fixture_calls where contact_id in ($1,$2)',[disabledId,nullId])),0,'CASE blocks locking validation for false/NULL channel');
  await q('rollback');
 }
 await db.exec(sql);
 assert.equal(await v("select pg_get_functiondef('icash_queue_voice_jobs()'::regprocedure)"),expected,'only two exact first-call fragments change; callbacks, locks, final validation and route recheck remain exact');
 assert.deepEqual(await v("select jsonb_object_agg(oid::regprocedure::text,pg_get_functiondef(oid)) from pg_proc where proname in ('icash_outreach_voice_current','icash_operational_contact_current','icash_prepare_operational_contacts','icash_queue_voice_jobs_before_operational')"),unchanged,'validator and original policy/delegates remain byte-identical');
 assert.equal(await v("select md5(string_agg(id::text||':'||state||':'||outcome,',' order by id)) from icash_voice_jobs where operational_contact_id<>$1",[nullKey]),priorState,'migration never rewrites prior jobs');
 // Channel and full proof checks precede LIMIT, so blocked earlier accounts
 // cannot starve a later eligible account. Preserve stable created_at/id order.
 for(let n=2000;n<2120;n++)await add(n,{a:disabled,age:500});
 for(let n=2200;n<2320;n++)await add(n,{a:unknown,age:500});
 for(let n=2400;n<2520;n++)await add(n,{allowed:false,age:500});
 const later=await add(2600,{a:other});
 await reset();await q('select icash_queue_voice_jobs()');
 for(const id of [positive,otherPositive,later])assert.equal(Number(await v('select count(*) from icash_voice_jobs where operational_contact_id=$1',[id])),1);
 assert.equal(Number(await v('select count(*) from icash_voice_jobs where account_id in ($1,$2)',[disabled,unknown])),0);
 assert.equal(Number(await v('select count(*) from fixture_calls c join icash_operational_contacts op on op.id=c.contact_id where op.account_id in ($1,$2)',[disabled,unknown])),0);
 for(const id of [positive,otherPositive,later])assert.equal(Number(await v('select count(*) from fixture_calls where contact_id=$1',[id])),2,'candidate proof and final locking proof both still execute');
 for(let n=3000;n<3101;n++)await add(n,{age:100});
 await reset();await q('select icash_queue_voice_jobs()');
 assert.equal(Number(await v('select count(*) from icash_voice_jobs where operational_contact_id>= $1 and operational_contact_id<=$2',[uid(3000),uid(3100)])),100,'unchanged bounded first-call batch');
 assert.equal(Number(await v('select count(*) from icash_voice_jobs where operational_contact_id=$1',[uid(3100)])),0,'created_at/id FIFO precedes unchanged limit');
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'icash_queue_voice_jobs()','execute')",[role]),false);
 assert.equal(await v("select has_function_privilege('service_role','icash_queue_voice_jobs()','execute')"),true);
 await assert.rejects(db.exec(sql),/Voice channel candidate prerequisite changed/);await db.exec('rollback');
 assert.equal(sql,read('supabase/migrations/20261019193341_voice_channel_candidate_fence.sql'));
 console.log(`Voice channel candidate fence: ${oldVisits} -> ${newVisits} calls for queued contacts; same candidate IDs, false/NULL/disabled policy before validator, mixed accounts, all prior states, final validation, FIFO/100 limit, unchanged callbacks/delegates/ACLs and fail-closed replay pass.`);
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await db.close();}
