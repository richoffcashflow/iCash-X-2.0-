// Actual production SQL over fictional receipts only. No provider or production access.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import {setupSql,costsSetup,migration as cashMigration,extract} from './helpers/cash-question-learning-fixture.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),foreign=id(2);
const native=process.env.ICASH_LEARNING_PLANNING_NATIVE==='1';
let db;
if(native){
 const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
 const client=new Client({host:'127.0.0.1',port:55543,user:'postgres',password:'isolated-fixture-only',database:'icash_learning_perf_c46',application_name:'seller-call-learning-planning-test',connectionTimeoutMillis:5000});
 await client.connect();
 try{
 const parameters=client.connectionParameters;
 assert.deepEqual(Object.fromEntries(['host','port','user','password','database','application_name'].map(k=>[k,parameters[k]])),{host:'127.0.0.1',port:55543,user:'postgres',password:'isolated-fixture-only',database:'icash_learning_perf_c46',application_name:'seller-call-learning-planning-test'},'Only the explicitly isolated disposable fixture may be used');
 assert.equal(client.connection.stream.remoteAddress,'127.0.0.1');
 assert.equal(client.connection.stream.remotePort,55543);
 const target=(await client.query("select current_database() db,current_user as username,current_setting('application_name') application_name")).rows[0];
 assert.deepEqual(target,{db:'icash_learning_perf_c46',username:'postgres',application_name:'seller-call-learning-planning-test'});
 assert.equal((await client.query("select count(*)::int count from pg_tables where schemaname='public' or schemaname like 'icash\\_%'")).rows[0].count,0,'Native test requires an empty disposable database');
 await client.query("set statement_timeout='60s';set lock_timeout='5s';set jit=off");
 }catch(error){await client.end();throw error;}
 db={query:(sql,args=[])=>client.query(sql,args),exec:sql=>client.query(sql),close:()=>client.end()};
}else db=new PGlite();
const q=(sql,args=[])=>db.query(sql,args),value=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
try{
 await db.exec(setupSql+costsSetup+cashMigration);
 await db.exec(`create table icash_usage_coverage(operation_key text primary key,account_id uuid,gross_cents bigint,customer_cents bigint,covered_cents bigint,evidence_ref text);`);
 await db.exec(read('tests/fixtures/outcome-cost-sources.sql'));
 for(const name of ['icash_dealmachine_request_started_at','icash_dealmachine_saved_owner_result_valid'])await db.exec(extract(read('config/dealmachine-dnc-observations.sql'),name));
 await db.exec(extract(read('config/owner-batch-contact-sources.sql'),'icash_dealmachine_owner_source_started_at'));
 for(const name of ['outcome-cost-sources','outcome-cost-source-planning','outcome-window-cost-collector','outcome-window-cost-learning'])await db.exec(read('config/'+name+'.sql'));
 const original=await value("select pg_get_functiondef('public.icash_refresh_seller_call_learning(uuid)'::regprocedure)");
 assert.equal(await value("select md5(prosrc) from pg_proc where oid='public.icash_refresh_seller_call_learning(uuid)'::regprocedure"),'6ee6a2f43a5fb1acbc8b3659482e6f8e','Fixture composes the exact observed production function body');
 const functionMetadata=()=>value("select jsonb_build_object('volatility',provolatile,'definer',prosecdef,'config',proconfig,'acl',proacl,'owner',pg_get_userbyid(proowner),'language',(select lanname from pg_language where oid=prolang)) from pg_proc where oid='public.icash_refresh_seller_call_learning(uuid)'::regprocedure");
 const originalMetadata=await functionMetadata();
 await db.exec(`
 create index fixture_screening_id on icash_screening_jobs(id);
 create index fixture_screening_property on icash_screening_jobs((snapshot->>'propertyId'),account_id) include(id);
 create index fixture_operation_key on icash_operation_spend(operation_key);
 create index fixture_operation_account on icash_operation_spend(account_id,operation_key);
 create index fixture_live_account on icash_live_conversations(account_id,screening_id,created_at);
 create index fixture_recording_account on icash_call_recordings(account_id,screening_id,created_at);
 create index fixture_assignments_account on icash_learning_assignments(account_id,domain);
 create index fixture_deal_screen on icash_deal_files(account_id,screening_id);
 create index fixture_threads on icash_text_threads(account_id,deal_id);
 create index fixture_messages on icash_text_messages(account_id,thread_id,created_at);
 create index fixture_permissions on icash_contact_permissions(id);
 create index fixture_operational_contacts on icash_operational_contacts(id);
 create index fixture_usage on icash_credit_ledger(account_id,event_key);
 begin;
 insert into icash_accounts(id,owner_user_id) values('${account}','${id(101)}'),('${foreign}','${id(102)}');
 create temporary table trials as
 select n,md5('screen-'||n)::uuid screening,md5('recording-'||n)::uuid recording,md5('deal-'||n)::uuid deal,
  md5('thread-'||n)::uuid thread,'p'||case when n=16 then 17 else n end property,
  '+1212555'||lpad(n::text,4,'0') phone,
  case when n%2=0 then 'reviewed' else 'limited' end context,
  case when n%2=0 then 'cash_interest' else 'flexible_timing' end variant,
  now()-case n when 1 then interval '1 hour' when 2 then interval '72 hours' when 3 then interval '72 hours'-interval '1 second'
   when 4 then interval '30 days' when 5 then interval '60 days' when 6 then interval '180 days' when 7 then interval '180 days 1 second'
   when 8 then interval '-1 hour' else case n%3 when 0 then interval '70 days' when 1 then interval '35 days' else interval '4 days' end end started
 from generate_series(1,305)n;
 insert into icash_screening_jobs(id,account_id,snapshot,result,created_at)
 select screening,'${account}',case n when 14 then '{}'::jsonb when 15 then '{"propertyId":""}'::jsonb
  else jsonb_build_object('propertyId',case when n=13 then 'practice_p13' else property end,'practice',n=11) end,
  jsonb_build_object('practice',n=12),started-interval '1 day' from trials;
 insert into icash_screening_jobs(id,account_id,snapshot,created_at)
 select md5('history-'||n)::uuid,'${account}',jsonb_build_object('propertyId',case when n<=305 then 'p'||n else 'history-'||n end),now()-interval '200 days'
 from generate_series(1,2511)n;
 insert into icash_learning_assignments(account_id,domain,subject,context,market,variant,policy_version,mode,created_at)
 select '${account}','seller_calls',screening||':contact-'||n,context,'*',variant,'shared-v1','explore',started-interval '1 hour' from trials;
 insert into icash_call_recordings(id,account_id,screening_id,party,operation_key,contact_key,to_phone,created_at,call_context)
 select recording,'${account}',screening,'seller','voice:trial:'||n,'contact-'||n,phone,started,
  jsonb_build_object('strategyKey',variant,'prompt',case when n=25 then 'unreviewed' else 'REVIEWED INTEREST QUESTION (shared-v1/'||context||'): Would you be interested in selling your property for all cash?' end) from trials;
 insert into icash_operation_spend(operation_key,account_id,state,created_at,dispatched_at,charged_cents,actual_micros,cost_basis,settled_at,settlement_evidence)
 select 'voice:trial:'||n,'${account}',case when n=9 then 'dispatched' else 'settled' end,started,started,
  case when n=9 then null when n=10 then 0 else 3 end,case when n=9 then null when n=10 then 0 else 30000 end,
  'verified',case when n=9 then null else started end,'fixture:original:voice:'||n from trials;
 insert into icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref,created_at)
 select account_id,'usage:'||operation_key,'usage',-charged_cents,'fixture:original:usage',created_at from icash_operation_spend where charged_cents>0;
 insert into icash_deal_files(id,account_id,screening_id,terms,created_at)
 select deal,'${account}',screening,'{}',started from trials;
 insert into icash_text_threads(id,account_id,deal_id,party,recipient,sender)
 select thread,'${account}',deal,'seller',phone,'+12125550000' from trials;
 -- Match the observed eligibility distribution without copying any customer data.
 insert into icash_contact_permissions(id,account_id,screening_id,party)
 select md5('permission-'||g.n)::uuid,'${account}',t.screening,'seller' from generate_series(1,506)g(n) join trials t on t.n=(g.n-1)%305+1;
 insert into icash_voice_jobs(id,account_id,permission_id,operation_key,provider_call_sid,state,created_at)
 select md5('voice-job-'||g.n)::uuid,'${account}',md5('permission-'||g.n)::uuid,
  case when g.n<=5 then null else 'voice:trial:'||t.n end,
  case when g.n=1 then 'fixture:provider' when g.n=4 then '' else null end,
  case g.n when 2 then 'dispatching' when 3 then 'dispatched' else 'complete' end,t.started
 from generate_series(1,506)g(n) join trials t on t.n=(g.n-1)%305+1;
 insert into icash_voice_jobs(id,account_id,operation_key,state,created_at)
 select md5('foreign-voice-job-'||n)::uuid,md5('foreign-account-'||n%599)::uuid,'fixture:foreign-job:'||n,'complete',now()-interval '10 days' from generate_series(1,32483)n;
 insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,contact_key,strategy_key,conversation_id,state,created_at,completed_at,result)
 select md5('conversation-'||n)::uuid,'${account}',screening,'seller','voice:trial:'||n,'contact-'||n,variant,'fixture:conversation:'||n,'complete',started,started+interval '1 minute',
 case when n=23 then '{"transcript":[{"role":"user","message":"Stop calling me"}],"optedOut":true}'::jsonb
 else '{"transcript":[{"role":"agent","message":"Would you be interested in selling your property for all cash?"},{"role":"user","message":"Yes"}]}'::jsonb end
 from trials where n in(23,24);
 -- Earlier contact on a different screening of the same property still excludes the trial.
 insert into icash_call_recordings(id,account_id,screening_id,party,operation_key,created_at,dial_claimed_at)
 select md5('prior-recording')::uuid,'${account}',md5('history-18')::uuid,'seller','voice:prior',started-interval '1 second',started-interval '1 second' from trials where n=18;
 insert into icash_text_messages(id,account_id,thread_id,direction,state,provider_id,body,created_at)
 select md5('prior-incoming')::uuid,'${account}',thread,'incoming','received','fixture:incoming','No thanks',started-interval '1 second' from trials where n=19;
 insert into icash_customer_phone_calls(id,account_id,screening_id,operation_key,created_at,connected_at)
 select md5('prior-browser')::uuid,'${account}',md5('history-20')::uuid,'browser:prior',started-interval '1 second',started-interval '1 second' from trials where n=20;
 insert into icash_text_suppressions(phone,reason) select phone,'fixture:optout' from trials where n=21;
 insert into icash_learning_private.cash_inbound_negatives(session_id,account_id,screening_id,contact_key,completed_at,disposition)
 select md5('inbound-negative')::uuid,'${account}',screening,encode(sha256(convert_to(phone,'UTF8')),'hex'),started+interval '1 minute','opt_out' from trials where n=22;
 -- An unrelated tenant has the same property and earlier contact; it must not suppress p24.
 insert into icash_screening_jobs(id,account_id,snapshot,created_at) values('${id(900)}','${foreign}','{"propertyId":"p24"}',now()-interval '200 days');
 insert into icash_call_recordings(id,account_id,screening_id,party,call_sid,dial_claimed_at,created_at)
 values('${id(901)}','${foreign}','${id(900)}','seller','fixture:foreign-call',now()-interval '200 days',now()-interval '200 days');
 insert into icash_learning_rollups(account_id,domain,context,market,variant,attempts)
 values('${foreign}','seller_calls','foreign','*','foreign',991),('${account}','seller_sms','keep','*','keep',992);
 update icash_learning_policy_private.outcome_cost_settings set installed_at=now()-interval '3 hours',enabled_at=now(),release_sha=repeat('a',40);
 analyze;
 `);
 assert.equal(await value('select count(*)::int from icash_screening_jobs where account_id=$1',[account]),2816);
 assert.equal(await value('select count(*)::int from icash_learning_assignments where account_id=$1',[account]),305);
 // Fully verified signatures and closing receipts exercise both equal-maturity objectives.
 for(const n of [4,5]){
  const trial=(await q('select * from trials where n=$1',[n])).rows[0];
  for(const [kind,days] of [['purchase',10],['assignment',15]]){
   const envelope=id(10000+n*2+(kind==='assignment'?1:0)),provider='fixture:'+kind+':'+n;
   const recipients=[{id:'seller',email:'seller@example.invalid'},{id:'buyer',email:'buyer@example.invalid'}];
   const evidence={id:provider,test_mode:false,status:'completed',apply_signing_order:true,metadata:{icash_envelope:envelope,terms_hash:'fixture:terms'},recipients:recipients.map((r,i)=>({...r,status:'signed',signing_order:i+1}))};
   await q(`insert into icash_signing_envelopes(id,account_id,deal_id,kind,terms_hash,recipients,test_mode,provider_id,state,provider_evidence,created_at,updated_at)
    values($1,$2,$3,$4,'fixture:terms',$5,false,$6,'completed',$7,$8::timestamptz+make_interval(days=>$9),$8::timestamptz+make_interval(days=>$9))`,[envelope,account,trial.deal,kind,JSON.stringify(recipients),provider,evidence,trial.started,days]);
  }
  const reply=id(11000+n);
  await q(`insert into icash_title_replies(id,account_id,deal_id,sender_verified,received_at) values($1,$2,$3,true,$4::timestamptz+interval '20 days');
  `,[reply,account,trial.deal,trial.started]);
  await q(`insert into icash_closing_updates(id,account_id,deal_id,reply_id,kind,effective_date,created_at,confirmation_source)
   values($1,$2,$3,$4,'closed',($5::timestamptz+interval '20 days')::date,$5::timestamptz+interval '20 days','verified_title_format')`,[id(12000+n),account,trial.deal,reply,trial.started]);
 }
 const sourceTables=(await q("select schemaname||'.'||tablename name from pg_tables where (schemaname='public' or schemaname like 'icash\\_%') and tablename<>'icash_learning_rollups' order by 1")).rows;
 const sourceSnapshot=async()=>{
  const snapshot={};
  for(const {name} of sourceTables)snapshot[name]=await value(`select md5(coalesce(jsonb_agg(row order by row::text)::text,'[]')) from (select to_jsonb(t) row from ${name} t)s`);
  return snapshot;
 };
 const beforeSources=await sourceSnapshot();
 const tableMetadata=()=>value("select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='public' or n.nspname like 'icash\\_%')");
 const beforeTableMetadata=await tableMetadata();
 const scopedCosts=()=>q("select n,icash_learning_private.seller_contact_window_costs($1,property,started,started+interval '72 hours') costs from trials where n<=26 order by n",[account]).then(r=>r.rows);
 const baselineCosts=await scopedCosts();
 for(const n of [1,2,3,4])assert.equal(baselineCosts.find(r=>r.n===n).costs.operationCount,2,'Provider-only, empty provider SID and dispatched/dispatching jobs retain missing-cost evidence');
 assert.equal(baselineCosts.find(r=>r.n===5).costs.operationCount,1,'An unstarted job without provider or operation evidence is not a cost source');
 const rollups=()=>q("select to_jsonb(r) row from icash_learning_rollups r order by account_id,domain,context,market,variant").then(r=>r.rows);
 const refresh=async()=>{const began=performance.now();await value('select icash_refresh_seller_call_learning($1)',[account]);return Math.round(performance.now()-began);};
 const baselineMs=await refresh(),baseline=await rollups();
 const total=await value("select jsonb_build_object('attempts',sum(attempts),'pending',sum(pending),'positive',sum(positive),'opted_out',sum(opted_out),'contracts',sum(contracts),'closings',sum(closings)) from icash_learning_rollups where account_id=$1 and domain='seller_calls'",[account]);
 assert.ok(total.attempts>280&&total.attempts<305,'Valid trials remain while practice, missing IDs, prior contact and unreviewed prompts are excluded');
 assert.equal(total.pending,2,'Fresh and just-immature exposure remain pending at the exact 72-hour boundary');
 assert.equal(total.positive,1,'The genuine bound yes survives the foreign tenant contact');
 assert.equal(total.opted_out,3,'Call, direct phone suppression and inbound opt-outs retain their separate evidence');
 assert.deepEqual([total.contracts,total.closings],[2,1],'Exact 30/60-day maturity preserves verified signatures and closing');
 const migration=read('config/seller-call-learning-planning.sql');
 assert.equal(migration,read('supabase/migrations/20261116041535_seller_call_learning_planning.sql'));
 assert.doesNotMatch(migration,/^(?:begin|commit);\s*$/im,'The migration runner owns the transaction');
 for(const [signature,error] of [
  ['public.icash_refresh_seller_call_learning(uuid)',/Reviewed seller-call learning source required/],
  ['icash_learning_private.seller_contact_window_costs(uuid,text,timestamptz,timestamptz)',/Reviewed seller-contact cost source required/],
 ]){
  await db.exec('savepoint source_drift');
  const definition=await value('select pg_get_functiondef($1::regprocedure)',[signature]);
  await db.exec(definition.replace('AS $function$','AS $function$\n-- fictional source drift'));
  await assert.rejects(db.exec(migration),error,'Source drift rejects the complete migration before any index is installed');
  await db.exec('rollback to savepoint source_drift;release savepoint source_drift');
  assert.equal(await value("select to_regclass('public.icash_learning_voice_cost_sources')"),null);
 }
 await db.exec('savepoint index_collision;create index icash_learning_voice_cost_sources on icash_voice_jobs(id)');
 await assert.rejects(db.exec(migration),/already exists/,'A later index failure rolls back the preceding function replacement');
 await db.exec('rollback to savepoint index_collision;release savepoint index_collision');
 assert.equal(await value("select pg_get_functiondef('public.icash_refresh_seller_call_learning(uuid)'::regprocedure)"),original);
 assert.equal(await value("select to_regclass('public.icash_learning_voice_cost_sources')"),null);
 await db.exec('savepoint ledger_failure');
 await db.exec(migration);
 await assert.rejects(db.exec("do $$begin raise exception 'fictional migration ledger failure';end$$"),/fictional migration ledger failure/,'A runner ledger failure after the complete SQL retains caller rollback');
 await db.exec('rollback to savepoint ledger_failure;release savepoint ledger_failure');
 assert.equal(await value("select pg_get_functiondef('public.icash_refresh_seller_call_learning(uuid)'::regprocedure)"),original);
 assert.equal(await value("select to_regclass('public.icash_learning_voice_cost_sources')"),null);
 await db.exec(migration);
 const optimized=await value("select pg_get_functiondef('public.icash_refresh_seller_call_learning(uuid)'::regprocedure)");
 assert.equal(optimized,original.replace('with properties as materialized (','with properties as not materialized ('),'Only property CTE planning changes');
 assert.deepEqual(await functionMetadata(),originalMetadata);
 assert.deepEqual(await tableMetadata(),beforeTableMetadata,'Table owners, private ACLs and RLS settings remain unchanged');
 const improvedMs=await refresh();
 assert.deepEqual(await rollups(),baseline,'Every complete rollup field, other tenant and other domain remain identical');
 assert.deepEqual(await scopedCosts(),baselineCosts,'Every contact-cost field preserves all eligible voice-source predicate branches');
 assert.deepEqual(await sourceSnapshot(),beforeSources,'All original receipts, financial records, assignments, controls and policy tables remain byte-equivalent');
 if(native){
  const helper=await value("select prosrc from pg_proc where oid='icash_learning_private.seller_contact_window_costs(uuid,text,timestamptz,timestamptz)'::regprocedure");
  const scope=helper.slice(helper.indexOf('with scope as materialized ('),helper.indexOf(', deals as materialized ('));
  const voice=helper.match(/select coalesce\(j\.operation_key,'missing:voice-job:'[\s\S]*?(?=\n  union all)/)?.[0];
  assert.ok(scope&&voice,'Explain the exact production helper branch');
  const branch=(scope+' '+voice).replaceAll('p_account','$1').replaceAll('p_property','$2').replaceAll('p_start','$3').replaceAll('p_end','$4');
  await db.exec('set local plan_cache_mode=force_generic_plan;prepare fixture_voice_cost(uuid,text,timestamptz,timestamptz) as '+branch);
  const start=await value("select started::text from trials where n=24");
  const plan=await value(`explain(analyze,buffers,format json) execute fixture_voice_cost('${account}','p24','${start}','${start}'::timestamptz+interval '72 hours')`);
  assert.ok(JSON.stringify(plan).includes('icash_learning_voice_cost_sources'),'The exact eligible voice branch uses the new account index with a generic plan');
  const walk=node=>[node,...(node.Plans??[]).flatMap(walk)],voiceNodes=walk(plan[0].Plan).filter(n=>n['Relation Name']==='icash_voice_jobs');
  assert.equal(voiceNodes.some(n=>n['Node Type']==='Seq Scan'),false,'Generic planning no longer scans all accounts\' voice jobs');
  console.log(`Native generic voice-source plan: icash_learning_voice_cost_sources; ${plan[0].Plan['Shared Hit Blocks']} shared buffer hits; ${plan[0]['Execution Time']}ms over 32989 fictional jobs.`);
  await db.exec('deallocate fixture_voice_cost;set local plan_cache_mode=auto');
 }
 // Reuse the compiled optimized plan after new contrary evidence, without rewriting sources.
 await q("insert into icash_contact_suppressions(account_id,contact_key,created_at) select $1,encode(sha256(convert_to(phone,'UTF8')),'hex'),now() from trials where n=24",[account]);
 await refresh();const lateOptimized=await rollups();
 assert.equal(await value("select sum(positive)::int from icash_learning_rollups where account_id=$1 and domain='seller_calls'",[account]),0,'Reused plans observe late suppressions');
 await db.exec(original);await refresh();assert.deepEqual(await rollups(),lateOptimized,'Late contrary evidence is identical under both plans');
 // Global cost-policy disable and null/missing accounts keep their original behavior.
 await q('update icash_learning_policy_private.outcome_cost_settings set enabled_at=null');await refresh();const disabled=await rollups();
 await db.exec(optimized);await refresh();assert.deepEqual(await rollups(),disabled,'Disabled outcome-cost gates retain all negative trials and incomplete costs');
 for(const empty of [null,id(999)])await value('select icash_refresh_seller_call_learning($1)',[empty]);
 assert.deepEqual(await rollups(),disabled,'Null and absent accounts cannot affect another account');
 await db.exec('rollback');
 console.log(`PASS seller-call planning: exact current SQL, 305 assignments / 2816 screenings, complete rollup equivalence, immutable evidence, tenant/practice/history boundaries, maturity and late suppression. Local refresh ${baselineMs}ms -> ${improvedMs}ms; not a production latency claim.`);
}finally{await db.close();}
