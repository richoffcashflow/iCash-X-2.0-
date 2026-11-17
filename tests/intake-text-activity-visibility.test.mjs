// Original SQL executes in isolated Postgres; no production/provider work.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const pg=await PGlite.create(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),other=id(2),empty=id(3);
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261117064608_intake_text_activity_visibility.sql');
const install=()=>pg.exec('begin;\n'+migration+'\ncommit;');
const baseline=read('supabase/migrations/20261005211700_workspace_activity_report.sql').replace('pg_catalog.pg_timezone_names','public.icash_timezone_names');
const rows=async(sql,values=[]) => (await pg.query(sql,values)).rows;
const value=async(sql,values=[])=>Object.values((await rows(sql,values))[0])[0];
const report=(a=account,days=30,zone='America/Chicago')=>value('select icash_activity_report($1,$2,$3)',[a,days,zone]);
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key);
 create view icash_timezone_names as select name from pg_catalog.pg_timezone_names;
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb default '{}',result jsonb default '{}',completed_at timestamptz);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,terms jsonb default '{}',seller_signed_at timestamptz);
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,seller_intake_id uuid);
 create table icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,direction text,state text,provider_id text,created_at timestamptz);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,dispatched_at timestamptz);
 create table icash_voice_jobs(operation_key text,account_id uuid,provider_call_sid text,conversation_id text,created_at timestamptz);
 create table icash_live_conversations(operation_key text,account_id uuid,screening_id uuid,conversation_id text,created_at timestamptz);
 create table icash_call_recordings(operation_key text,account_id uuid,screening_id uuid,call_sid text,provider_started_at timestamptz);
 create table icash_meta_leads(lead_id uuid primary key,account_id uuid,screening_id uuid unique);
 create table icash_meta_lead_messages(message_id uuid primary key,lead_id uuid);
 insert into icash_accounts values('${account}'),('${other}'),('${empty}');`);
 await pg.exec(baseline);
 assert.equal(await value("select md5(pg_get_functiondef('icash_activity_report(uuid,integer,text)'::regprocedure))"),'869238dd65e4d8af148e32757577db69');
 assert.equal(migration,read('config/intake-text-activity-visibility.sql'));
 const source=await value("select pg_get_functiondef('icash_activity_report(uuid,integer,text)'::regprocedure)");
 const metadata=()=>rows("select proacl,proowner,provolatile,prosecdef,proconfig from pg_proc where oid='icash_activity_report(uuid,integer,text)'::regprocedure");
 const beforeMetadata=await metadata();
 async function message(n,opts={}){
  const a=opts.account??account,screen=id(100+n),deal=id(200+n),thread=id(300+n),message=id(400+n),lead=id(500+n);
  const state=opts.screenState??'awaiting_address',property=opts.property??(state==='complete'?`prop_${n}`:null);
  await pg.query(`insert into icash_screening_jobs values($1,$2,$3,$4,$5,now()-interval '1 hour')`,[screen,opts.screenAccount??a,state,opts.snapshot??{},{property:{propertyId:property}}]);
  await pg.query(`insert into icash_deal_files values($1,$2,$3,$4,null)`,[deal,opts.dealAccount??a,screen,opts.terms??{}]);
  await pg.query(`insert into icash_text_threads values($1,$2,$3,$4)`,[thread,opts.threadAccount??a,deal,opts.threadLead??lead]);
  await pg.query(`insert into icash_text_messages values($1,$2,$3,$4,$5,$6,now()-$7::interval)`,[message,a,thread,opts.direction??'outgoing',opts.state??'delivered',opts.provider===undefined?'provider-'+n:opts.provider,opts.age??'1 hour']);
  if(opts.meta!==false)await pg.query('insert into icash_meta_leads values($1,$2,$3)',[lead,opts.metaAccount??a,screen]);
  if(opts.receipt!==false)await pg.query('insert into icash_meta_lead_messages values($1,$2)',[message,opts.receiptLead??lead]);
  if(opts.dispatchedAge)await pg.query("insert into icash_operation_spend values($1,$2,now()-$3::interval)",['text:'+message,a,opts.dispatchedAge]);
  return {screen,deal,thread,message,lead};
 }
 const complete=await message(1,{screenState:'complete'});
 const intake=await message(2);
 await message(3,{state:'accepted',age:'2 days'});
 await message(4,{age:'12 days'});
 await message(5,{age:'35 days'});
 await message(6,{age:'40 days',dispatchedAge:'3 days'});
 await message(7,{age:'2 days',dispatchedAge:'40 days'});
 await message(8,{account:other});
 // None of these are new reportable provider-backed intake sends.
 const excluded=[{state:'ready',provider:null},{state:'dispatching',provider:null},{state:'failed'},{state:'needs_review'},
  {provider:null},{provider:''},{direction:'incoming',state:'received'},{screenState:'archived'},
  {snapshot:{practice:true}},{property:'practice_fixture'},{terms:{practice:true}},
  {meta:false},{receipt:false},{metaAccount:other},{threadLead:id(999)},{receiptLead:id(998)},
  {screenAccount:other},{dealAccount:other},{threadAccount:other},{screenState:'failed'},
  {screenState:'queued'},{screenState:'running'},{age:'-1 hour'},
  {property:'',snapshot:{propertyId:'practice_fallback'}}];
 for(const [index,opts] of excluded.entries())await message(20+index,opts);
 await pg.query("insert into icash_voice_jobs values('voice:test',$1,'CA_fixture',null,now()-interval '1 hour')",[account]);
 await pg.query('update icash_deal_files set seller_signed_at=now()-interval \'1 hour\' where id=$1',[complete.deal]);
 const old30=await report();assert.equal(old30.texts,1);
 const snapshots=await rows(`select (select jsonb_agg(t) from icash_text_messages t) messages,(select jsonb_agg(t) from icash_text_threads t) threads,(select jsonb_agg(t) from icash_operation_spend t) spend`);
 // Source drift and broader execution privileges must block installation.
 await pg.exec(source.replace('declare starts','-- changed fixture\ndeclare starts'));
 await assert.rejects(install(),/prerequisite changed/);await pg.exec('rollback;');await pg.exec(source);
 await pg.exec('grant execute on function icash_activity_report(uuid,integer,text) to authenticated;');
 await assert.rejects(install(),/prerequisite changed/);await pg.exec('rollback;');
 await pg.exec('revoke execute on function icash_activity_report(uuid,integer,text) from authenticated;');
 await install();
 assert.deepEqual(await metadata(),beforeMetadata);
 const changed=await report();assert.equal(changed.texts,5,'one completed property text and four original, admitted intake receipts');
 for(const key of ['leads','calls','contracts'])assert.equal(changed[key],old30[key]);
 assert.equal((await report(other)).texts,1);assert.equal((await report(empty)).texts,0);
 assert.equal((await report(account,7)).texts,4,'original dispatch time controls report window');
 const start=await value("select (((now() at time zone 'America/Chicago')::date)::timestamp at time zone 'America/Chicago')");
 const todayBefore=(await report(account,1)).texts;
 const boundary=await message(70,{age:'0 hours'});
 await pg.query('update icash_text_messages set created_at=$1 where id=$2',[start,boundary.message]);
 assert.equal((await report(account,1)).texts,todayBefore+1,'local midnight is inclusive');
 await pg.query("update icash_text_messages set created_at=$1::timestamptz-interval '1 microsecond' where id=$2",[start,boundary.message]);
 assert.equal((await report(account,1)).texts,todayBefore,'before local midnight is excluded');
 assert.equal((await report(account,7)).texts,5);
 // Promoting the SAME screen to a property changes only its eligibility branch.
 const beforePromotion=(await report()).texts;
 await pg.query("update icash_screening_jobs set state='complete',result=$2,completed_at=now() where id=$1",[intake.screen,{property:{propertyId:'prop_promoted'}}]);
 assert.equal((await report()).texts,beforePromotion,'address completion cannot count an original message twice');
 // Migration itself never touches saved state, financials or provider evidence.
 const afterSnapshots=await rows(`select (select jsonb_agg(t) from icash_text_messages t where id<> '${boundary.message}') messages,(select jsonb_agg(t) from icash_text_threads t where id<> '${boundary.thread}') threads,(select jsonb_agg(t) from icash_operation_spend t) spend`);
 assert.deepEqual(afterSnapshots,snapshots);
 for(const [days,zone] of [[0,'UTC'],[2,'UTC'],[31,'UTC'],[1,'Invalid/Zone']])await assert.rejects(report(account,days,zone),/Invalid reporting/);
 assert.equal(await report(id(9999)),null);
 await assert.rejects(install(),/prerequisite changed/);await pg.exec('rollback;');
 console.log('PASS intake text activity: exact source/ACL guard, verified receipt/account/thread binding, all periods, original dispatch time, local midnight, practice/unsent exclusions, stable counts after promotion, unchanged calls/leads/contracts and no data writes.');
 console.log('Post-migration function hash:',await value("select md5(pg_get_functiondef('icash_activity_report(uuid,integer,text)'::regprocedure))"));
}finally{await pg.close();}
