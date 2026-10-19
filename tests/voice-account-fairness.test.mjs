// LOCAL ONLY: synthetic queue/tickets. No provider requests or paid work.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args);
const value=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const a=uid(1),b=uid(2),c=uid(3);
const baseline=read('tests/fixtures/voice-issuer-before-fairness.sql');
const migration=read('config/voice-account-fairness.sql');
let scenarios=0;
const scenario=async(name,fn)=>{await pg.exec('begin');try{await fn();scenarios++;}catch(e){throw new Error(name+': '+e.message,{cause:e});}finally{await pg.exec('rollback');}};
// A scenario is one transaction, so now() is fixed. Age ticket history with the
// scheduler clock to model another ordinary 31-second dispatch interval.
const releaseSlot=()=>pg.exec("update icash_voice_scheduler set last_dispatch_at=now()-interval '31 seconds';update icash_automation_tickets set created_at=created_at-interval '31 seconds'");
const next=async()=>{const r=await value('select icash_next_before_fulfillment()');return r?.token?value('select voice_job_id from icash_automation_tickets where token=$1',[r.token]):null;};
const add=async(n,account=a,age=3600,more={})=>{
 const id=uid(n);await q('insert into icash_voice_jobs(id,account_id,due_at) values($1,$2,now()-$3*interval \'1 second\')',[id,account,age]);
 for(const [key,v] of Object.entries(more)){
  assert(['state','outcome','callback_id','sms_source_message_id','sms_requested_at','sms_requested_by','cancellation_notice_id','permission_id','operational_contact_id','meta_offer_lead_id','meta_followup_lead_id'].includes(key));
  await q(`update icash_voice_jobs set ${key}=$2 where id=$1`,[id,v]);
 }return id;
};
const pastTicket=async(account,age=300,state='held')=>q("insert into icash_automation_tickets(account_id,kind,created_at,state) values($1,'voice_dispatch',now()-$2*interval '1 second',$3)",[account,age,state]);
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_operating_budget(id int primary key,enabled boolean default true);insert into icash_operating_budget values(1,true);
 create table icash_accounts(id uuid primary key,bot_paused boolean default false,owner_user_id uuid);
 create table icash_wallets(account_id uuid primary key,balance_cents bigint default 10000,reserved_cents bigint default 0);
 create table icash_voice_configs(account_id uuid primary key,enabled boolean default true);
 create table icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid,operational_contact_id uuid,state text default 'ready',due_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now(),callback_id uuid,sms_source_message_id uuid,sms_requested_at timestamptz,sms_requested_by uuid,cancellation_notice_id uuid,meta_offer_lead_id uuid,meta_followup_lead_id uuid,operation_key text,provider_call_sid text,conversation_id text,outcome text);
 create table icash_voice_scheduler(id int primary key,last_dispatch_at timestamptz);insert into icash_voice_scheduler(id) values(1);
 create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,voice_job_id uuid,token text unique default gen_random_uuid()::text,created_at timestamptz default now(),state text default 'issued',outcome text);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text);
 create table icash_meta_leads(lead_id uuid primary key,account_id uuid,screening_id uuid,voice_job_id uuid);
 create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,phone text,contact_key text,party text default 'seller',seller_intake_id uuid);
 create table icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,phone text,contact_key text,party text default 'seller');
 create view icash_voice_contact_targets as select id,account_id,screening_id,phone,contact_key,party,'operator_record'::text eligibility_source from icash_contact_permissions union all select id,account_id,screening_id,phone,contact_key,party,'operational_checks_only' from icash_operational_contacts;
 create table icash_live_callbacks(id uuid primary key,account_id uuid,screening_id uuid,conversation_id uuid,state text,due_at timestamptz);
 create table icash_live_conversations(id uuid primary key,account_id uuid,screening_id uuid,contact_key text,party text,state text,result jsonb,completed_at timestamptz);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid);
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,seller_intake_id uuid,recipient text);
 create table icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,direction text,state text,created_at timestamptz);
 create table fixture_source_checks(account_id uuid,message_id uuid,permission_id uuid,current boolean default true);
 create table fixture_cancellation_checks(account_id uuid,operation_key text,current boolean);
 create table icash_operation_spend(operation_key text primary key,state text,actual_micros bigint,charged_cents bigint);
 insert into icash_operation_spend values('fixture-unknown','dispatched',null,null),('fixture-settled','settled',123000,25);
 create function icash_queue_voice_jobs() returns void language sql as $$select$$;
 create function icash_next_before_voice_dispatch() returns jsonb language sql as $$select null::jsonb$$;
 create function icash_requested_seller_call_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_cancellation_voice_current(uuid,text) returns boolean language sql stable as $$select exists(select 1 from public.fixture_cancellation_checks where account_id=$1 and operation_key=$2 and current)$$;
 create function icash_seller_sms_call_current(uuid,uuid) returns boolean language sql stable as $$select exists(select 1 from public.fixture_source_checks where account_id=$1 and message_id=$2 and current)$$;
 create function icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql stable as $$select exists(select 1 from public.fixture_source_checks where account_id=$1 and permission_id=$2 and current)$$;
 `);
 // Execute the real receipt-bound current-request predicate and response detector.
 const requested=read('config/requested-seller-callback-hours.sql').match(/create function public\.icash_requested_seller_call_current[^]*?\$\$;/)[0];
 await pg.exec('drop function icash_requested_seller_call_current(uuid,uuid);'+requested);
 const response=read('config/opportunity-engine.sql').match(/create function public\.icash_call_has_seller_response[^]*?\$\$;/)[0];await pg.exec(response);
 for(const account of [a,b,c]){
  await q('insert into icash_accounts(id,owner_user_id) values($1,$1)',[account]);
  await q('insert into icash_wallets(account_id) values($1)',[account]);
  await q('insert into icash_voice_configs(account_id) values($1)',[account]);
 }
 await pg.exec(baseline);
 await pg.exec('revoke all on function icash_next_before_fulfillment() from public,anon,authenticated;grant execute on function icash_next_before_fulfillment() to service_role;');
 const before=await value("select pg_get_functiondef('icash_next_before_fulfillment()'::regprocedure)");
 const invariantNames=['icash_queue_voice_jobs()','icash_next_before_voice_dispatch()','icash_requested_seller_call_current(uuid,uuid)','icash_seller_voice_permission_current(uuid,uuid)','icash_seller_sms_call_current(uuid,uuid)'];
 const preserved=await Promise.all(invariantNames.map(n=>value('select pg_get_functiondef($1::regprocedure)',[n])));
 await pg.exec(migration);
 const after=await value("select pg_get_functiondef('icash_next_before_fulfillment()'::regprocedure)");
 const oldSelection=migration.split('$original$')[1],newSelection=migration.split('$replacement$')[1];
 assert.equal(after.replace(newSelection,oldSelection),before,'only candidate selection changes; queueing, 30s gate, locking, issued transition, new ticket and fallback are exact');
 assert.deepEqual(await Promise.all(invariantNames.map(n=>value('select pg_get_functiondef($1::regprocedure)',[n]))),preserved);
 const financialBefore=await value('select jsonb_build_object(\'wallets\',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w),\'spend\',(select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s))');
 await scenario('never served funded account beats hundreds of older jobs',async()=>{
  for(let i=100;i<500;i++)await add(i,a,7200+i);
  await pastTicket(a);await q('update icash_wallets set balance_cents=0 where account_id=$1',[b]);
  const fresh=await add(500,b,1);assert.notEqual(await next(),fresh);await releaseSlot();
  await q('update icash_wallets set balance_cents=10000 where account_id=$1',[b]);
  assert.equal(await next(),fresh);
 });
 await scenario('unserved accounts rotate and failures consume a turn',async()=>{
  const aa=await add(100,a,7200),ab=await add(101,a,7100),bb=await add(200,b,1),cc=await add(300,c,2);
  assert.equal(await next(),aa);
  await q("update icash_voice_jobs set state='held',outcome='permission_changed' where id=$1",[aa]);
  await pg.exec("update icash_automation_tickets set state='held',outcome='permission_changed'");
  await releaseSlot();assert.equal(await next(),cc);await releaseSlot();assert.equal(await next(),bb);
  await releaseSlot();assert.equal(await next(),ab);
 });
 await scenario('least recently served first, ordinary FIFO and stable tie',async()=>{
  await pastTicket(a,10);await pastTicket(b,100);await pastTicket(c,200);
  const aa=await add(100,a,7200),bb=await add(200,b,3600),cc=await add(300,c,1);
  assert.equal(await next(),cc);await releaseSlot();assert.equal(await next(),bb);await releaseSlot();assert.equal(await next(),aa);
  const first=await add(101,a,600),same=await add(102,a,600),later=await add(103,a,1);
  await releaseSlot();assert.equal(await next(),first);await releaseSlot();assert.equal(await next(),same);await releaseSlot();assert.equal(await next(),later);
 });
 await scenario('multiple rounds cannot return all slots to the largest account',async()=>{
  const expected=[];
  for(let i=0;i<3;i++){
   await add(100+i,a,7200-i);await add(200+i,b,3600-i);await add(300+i,c,60-i);
   expected.push(uid(100+i),uid(200+i),uid(300+i));
  }
  for(const job of expected){assert.equal(await next(),job);await releaseSlot();}
 });
 const callback=async({n=600,account=a,age=30,operational=false,result,callAccount=account,callKey='fixture-key',screenAccount=account}={})=>{
  const id=uid(n),screen=uid(n+1),contact=uid(n+2),call=uid(n+3),cb=uid(n+4);
  await q('insert into icash_screening_jobs values($1,$2,\'complete\')',[screen,screenAccount]);
  await q(`insert into ${operational?'icash_operational_contacts':'icash_contact_permissions'}(id,account_id,screening_id,contact_key) values($1,$2,$3,'fixture-key')`,[contact,account,screen]);
  await q("insert into icash_live_conversations values($1,$2,$3,$4,'seller','complete',coalesce($5::jsonb,jsonb_build_object('callbackDueAt',now()-$6*interval '1 second','transcript',jsonb_build_array(jsonb_build_object('role','user','message','Please call me then')))),now()-interval '1 minute')",[call,callAccount,screen,callKey,result??null,age]);
  await q("insert into icash_live_callbacks values($1,$2,$3,$4,'pending_dispatch_review',now()-$5*interval '1 second')",[cb,account,screen,call,age]);
  await add(n,account,age,{callback_id:cb,[operational?'operational_contact_id':'permission_id']:contact});return id;
 };
 await scenario('receipt-backed due callback precedes fresh account',async()=>{
  await pastTicket(a,1);await add(100,b,7200);const cb=await callback({operational:true});assert.equal(await next(),cb);
 });
 for(const [label,settings,change] of [
  ['future',{age:-60}],['expired',{age:901}],['no response',{result:JSON.stringify({callbackDueAt:'2026-01-01',transcript:[]})}],
  ['malformed callback date',{result:JSON.stringify({callbackDueAt:'invalid date',transcript:[{role:'user',message:'Please call'}]})}],
  ['foreign account',{callAccount:b}],['wrong contact',{callKey:'another-key'}],
  ['changed due',{},"update icash_live_callbacks set due_at=due_at-interval '1 second'"],
  ['not completed',{},"update icash_live_conversations set state='waiting'"],
  ['missing completion receipt',{},'update icash_live_conversations set completed_at=null'],
  ['revoked appointment',{},"update icash_live_callbacks set state='canceled'"],
 ])await scenario('callback is not urgent: '+label,async()=>{
  await pastTicket(a,1);const ordinary=await add(100,b,7200);await callback(settings);if(change)await pg.exec(change);assert.equal(await next(),ordinary);
 });
 await scenario('source UUID collision cannot establish callback priority',async()=>{
  await pastTicket(a,1);const ordinary=await add(100,b,7200);await callback({operational:true,callKey:'other-key'});
  await q("insert into icash_contact_permissions(id,account_id,screening_id,contact_key) values($1,$2,$3,'other-key')",[uid(602),a,uid(601)]);
  assert.equal(await next(),ordinary);
 });
 const sms=async()=>{
  const id=uid(700),contact=uid(701),screen=uid(702),deal=uid(703),thread=uid(704),message=uid(705),intake=uid(706);
  await q("insert into icash_contact_permissions(id,account_id,screening_id,phone,seller_intake_id) values($1,$2,$3,'+12025550100',$4)",[contact,a,screen,intake]);
  await q('insert into icash_deal_files values($1,$2,$3)',[deal,a,screen]);
  await q("insert into icash_text_threads values($1,$2,$3,'seller',$4,'+12025550100')",[thread,a,deal,intake]);
  await q("insert into icash_text_messages values($1,$2,$3,'incoming','received',now()-interval '1 minute')",[message,a,thread]);
  await q('insert into fixture_source_checks values($1,$2,$3,true)',[a,message,contact]);
  await add(700,a,10,{permission_id:contact,sms_source_message_id:message});
  await q('update icash_voice_jobs set sms_requested_at=now() where id=$1',[id]);return id;
 };
 await scenario('current received SMS call-now request has priority',async()=>{
  await pastTicket(a,1);await add(100,b,7200);assert.equal(await nextAfter(sms),uid(700));
 });
 async function nextAfter(create){await create();return next();}
 for(const [label,change] of [
  ['expired request',"update icash_voice_jobs set sms_requested_at=now()-interval '6 minutes' where sms_source_message_id is not null"],
  ['unreceived message',"update icash_text_messages set state='needs_review'"],
  ['foreign message',`update icash_text_messages set account_id='${b}'`],
  ['wrong recipient',"update icash_text_threads set recipient='+12025550101'"],
  ['permission/reply no longer current','update fixture_source_checks set current=false'],
 ])await scenario('SMS is not urgent: '+label,async()=>{await pastTicket(a,1);const ordinary=await add(100,b,7200);await sms();await pg.exec(change);assert.equal(await next(),ordinary);});
 await scenario('cancellation requires existing current helper',async()=>{
  await pastTicket(a,1);const ordinary=await add(100,b,7200),notice=await add(800,a,1,{cancellation_notice_id:uid(801)});
  await q('insert into fixture_cancellation_checks values($1,$2,true)',[a,'voice:'+notice]);assert.equal(await next(),notice);
  await releaseSlot();await q("update icash_voice_jobs set state='ready' where id=$1",[notice]);await pg.exec('update fixture_cancellation_checks set current=false');assert.equal(await next(),ordinary);
 });
 await scenario('global30second admission survives repeated pollers',async()=>{
  await add(100,a);await add(200,b);assert(await next());for(let i=0;i<5;i++)assert.equal(await next(),null);assert.equal(Number(await value('select count(*) from icash_automation_tickets')),1);
 });
 for(const [label,change] of [
  ['Pause','update icash_accounts set bot_paused=true'],['disabled voice','update icash_voice_configs set enabled=false'],
  ['no wallet credits','update icash_wallets set balance_cents=0'],['unknown holds exhaust wallet','update icash_wallets set reserved_cents=balance_cents'],
  ['company budget stopped','update icash_operating_budget set enabled=false'],
  ['unknown provider job',"update icash_voice_jobs set state='held',outcome='provider_outcome_unknown_no_retry'"],
 ])await scenario(label,async()=>{const job=await add(100,a);await pg.exec(change);const before=await value('select to_jsonb(j) from icash_voice_jobs j where id=$1',[job]);assert.equal(await next(),null);assert.deepEqual(await value('select to_jsonb(j) from icash_voice_jobs j where id=$1',[job]),before);});
 await scenario('Meta initial call remains on its separate serialized path',async()=>{
  const job=await add(900,a,7200,{permission_id:uid(901)}),ordinary=await add(100,b,1);
  await q("insert into icash_screening_jobs values($1,$2,'awaiting_address')",[uid(902),a]);
  await q('insert into icash_meta_leads values($1,$2,$3,$4)',[uid(903),a,uid(902),job]);
  assert.equal(await next(),ordinary);await releaseSlot();assert.equal(await next(),null);
 });
 assert.deepEqual(await value('select jsonb_build_object(\'wallets\',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w),\'spend\',(select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s))'),financialBefore);
 for(const role of ['anon','authenticated'])assert.equal(await value("select has_function_privilege($1,'icash_next_before_fulfillment()','execute')",[role]),false);
 assert.equal(await value("select has_function_privilege('service_role','icash_next_before_fulfillment()','execute')"),true);
 assert.equal(await value("select prosecdef from pg_proc where oid='icash_next_before_fulfillment()'::regprocedure"),false);
 assert.equal(migration,read('supabase/migrations/20261019184904_voice_account_fairness.sql'));
 // Unknown prerequisite versions fail without partially applying a new selector.
 await pg.exec('drop index icash_automation_voice_account_recent');
 await assert.rejects(pg.exec(migration),/Voice account fairness prerequisite changed/);await pg.exec('rollback');
 assert.equal(await value("select pg_get_functiondef('icash_next_before_fulfillment()'::regprocedure)"),after);
 console.log(`Voice account fairness: ${scenarios} local scenarios pass; never-served/least-recent/FIFO, failing-account rotation, receipt-bound urgency,30sec global gate, Meta path, Pause/wallet/holds and unchanged financial state/private ACLs.`);
}catch(e){console.error(e.message,e.cause?.where??e.where??'');process.exitCode=1;}finally{await pg.close();}
