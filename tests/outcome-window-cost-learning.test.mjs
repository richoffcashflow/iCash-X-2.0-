// Execute the production collector and forward integration over synthetic receipts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createRequire} from 'node:module';
import {setupSql,costsSetup,migration as cashMigration} from './helpers/cash-question-learning-fixture.mjs';
import {sharedLearningDecision,sharedLearningStats} from '../lib/shared-learning.ts';
import {assertDisposablePostgresTarget} from './helpers/disposable-postgres-target.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const composition="begin;\nset local lock_timeout='5s';\nset local statement_timeout='60s';\nselect pg_advisory_xact_lock(726341927);\nselect 1 from public.icash_operating_budget where id=1 for update;\n"+['outcome-title-cost-attribution','outcome-cost-sources','outcome-window-cost-collector','outcome-window-cost-learning'].map(n=>read('config/'+n+'.sql')).join('\n')+'\ncommit;\n';
assert.equal(read('supabase/migrations/20261115064518_customer_results_outcome_costs.sql'),composition,'The generated migration is the ordered atomic composition of the tested configs');
const extract=(s,n)=>s.match(new RegExp('create (?:or replace )?function public\\.'+n+'\\([\\s\\S]*?(?:\\$\\$|\\$function\\$);','i'))?.[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const native=process.env.ICASH_OUTCOME_NATIVE==='1';
let db;
if(native){
 const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',connectionTimeoutMillis:5000});await c.connect();
 try{await assertDisposablePostgresTarget(c);}catch(error){await c.end();throw error;}
 db={query:(s,a=[])=>c.query(s,a),exec:s=>c.query(s),close:()=>c.end()};
 await db.exec("set statement_timeout='45s';set lock_timeout='5s';set jit=off;");
 await db.exec('drop schema if exists public cascade;create schema public;'+['icash_learning_private','icash_learning_policy_private','icash_recorded_reception_private','icash_seller_agreement_private','icash_reception_private','icash_reliability_private','icash_contact_refresh_private','icash_seller_recovery_private','icash_research_private'].map(s=>'drop schema if exists '+s+' cascade;').join(''));
 await db.exec("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;");
}else db=new PGlite();
const q=(s,a=[])=>db.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
try{
 await db.exec((setupSql+costsSetup+cashMigration).replace('create role anon;create role authenticated;create role service_role;',native?'':'create role anon;create role authenticated;create role service_role;'));
 await db.exec(`
 create table icash_usage_coverage(operation_key text primary key,account_id uuid,gross_cents bigint,customer_cents bigint,covered_cents bigint,evidence_ref text);
 create index fixture_operations_account_key on icash_operation_spend(account_id,operation_key);
 create index fixture_ledger_account_event on icash_credit_ledger(account_id,event_key);
 create index fixture_screening_account_property on icash_screening_jobs(account_id,(snapshot->>'propertyId'));
 create table fixture_sources(property_id text,operation_key text,created_at timestamptz,observed_at timestamptz,unattributed boolean default false,acquisition boolean default false,share_count integer default 1,share_rank integer default 1);
 create function icash_learning_private.outcome_cost_sources(uuid) returns table(property_id text,operation_key text,created_at timestamptz,observed_at timestamptz,unattributed boolean,acquisition boolean,share_count integer,share_rank integer) language sql as 'select * from public.fixture_sources';
 `);
 await db.exec(read('config/outcome-window-cost-collector.sql'));
 await db.exec(read('config/outcome-window-cost-learning.sql'));
 const now=Date.parse(await val('select now()')),stamp=d=>new Date(now-d*86400000).toISOString();
 const start=stamp(70),acquired=stamp(71),during=stamp(69),after30=stamp(35);
 await q('insert into icash_accounts(id,owner_user_id) values($1,$2),($3,$4)',[id(1),id(11),id(2),id(12)]);
 await q("insert into icash_screening_jobs(id,account_id,snapshot,created_at) values($1,$2,'{\"propertyId\":\"p1\"}',$3),($4,$2,'{\"propertyId\":\"p2\"}',$3)",[id(100),id(1),acquired,id(101)]);
 const op=async(key,{account=1,at=during,cents=3,state='settled',basis='verified',dispatch=at,evidence='fixture:receipt',ledger=true}={})=>{
  await q(`insert into icash_operation_spend(operation_key,account_id,state,created_at,dispatched_at,charged_cents,actual_micros,cost_basis,settled_at,settlement_evidence) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[key,id(account),state,at,dispatch,cents,cents*10000,basis,at,evidence]);
  if(ledger&&cents>0)await q("insert into icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref,created_at) values($1,$2,'usage',$3,'fixture:usage',$4)",[id(account),'usage:'+key,-cents,at]);
 };
 const source=(key,{property='p1',at=during,acquisition=false,rank=1,shares=1,unattributed=false}={})=>q('insert into fixture_sources values($1,$2,$3,$3,$4,$5,$6,$7)',[property,key,at,unattributed,acquisition,shares,rank]);
 const costs=(property='p1',days=30,at=start)=>val('select icash_learning_private.outcome_window_costs($1,$2,$3,$4)',[id(1),property,at,days]);
 assert.equal((await costs()).complete,false,'No source history is not proof of free work');
 await op('page:one',{at:stamp(72),cents:11,basis:'estimated'});
 await source('page:one',{at:acquired,acquisition:true,shares:2,rank:1});await source('page:one',{property:'p2',at:acquired,acquisition:true,shares:2,rank:2});
 await q("insert into icash_usage_coverage values('page:one',$1,11,7,4,'fixture:coverage')",[id(1)]);
 await q("insert into icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref) values($1,'usage-coverage:page:one','grant',4,'fixture:coverage')",[id(1)]);
 let c=await costs(),other=await costs('p2');
 assert.deepEqual([c.complete,c.costCents,other.costCents,c.providerCostsComplete],[true,4,3,false],'Original dispatch predates inventory; exact net seven-cent page shares conserve cost and keep supplier estimates separate');
 await source('page:one',{at:acquired,acquisition:true,shares:2,rank:1});assert.equal((await costs()).costCents,4,'Same source repeated does not duplicate charge');
 await op('voice:one');await source('voice:one');
 await op('buyer:later',{at:after30,cents:8});await source('buyer:later',{at:after30});
 assert.deepEqual([(await costs()).costCents,(await costs('p1',60)).costCents],[7,15],'Buyer/title/progression costs after 30 days belong only to the 60-day denominator');
 await q("update icash_usage_coverage set customer_cents=8 where operation_key='page:one'");assert.equal((await costs()).complete,false,'Coverage must exactly conserve gross usage');await q("update icash_usage_coverage set customer_cents=7 where operation_key='page:one'");
 await q("delete from icash_credit_ledger where event_key='usage-coverage:page:one'");assert.equal((await costs()).complete,false,'A coverage row alone cannot erase a customer charge');
 await q("insert into icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref) values($1,'usage-coverage:page:one','grant',4,'fixture:coverage')",[id(1)]);
 await q("insert into icash_credit_ledger select * from icash_credit_ledger where event_key='usage:voice:one'");assert.equal((await costs()).complete,false,'Duplicate usage entries fail closed');
 await q("delete from icash_credit_ledger where ctid in(select ctid from icash_credit_ledger where event_key='usage:voice:one' limit 1)");
 await q("update fixture_sources set share_rank=1 where property_id='p2'");assert.equal((await costs()).complete,false,'Conflicting page ranks cannot double allocate the remainder');await q("update fixture_sources set share_rank=2 where property_id='p2'");
 await op('unknown:paid');assert.equal((await costs()).complete,false,'An admitted unbound operation blocks complete attribution instead of disappearing');
 await source('unknown:paid',{property:'p2'});assert.equal((await costs()).complete,true,'An exact other-property receipt removes ambiguity without charging this property');
 await source('voice:one',{property:'p2'});assert.equal((await costs()).complete,false,'One ordinary operation cannot belong to two properties');await q("delete from fixture_sources where operation_key='voice:one' and property_id='p2'");
 await op('explicit-zero',{cents:0});await source('explicit-zero');assert.equal((await costs()).complete,true,'A settled explicit zero is allowed without a fabricated zero ledger row');
 await q("update icash_operation_spend set settlement_evidence='' where operation_key='explicit-zero'");assert.equal((await costs()).complete,false,'A zero without original settlement evidence is unknown');await q("update icash_operation_spend set settlement_evidence='fixture:zero' where operation_key='explicit-zero'");
 assert.equal((await costs('p1',29)).complete,false);assert.equal((await costs('p1',30,stamp(20))).complete,false,'Immature windows never certify completeness');
 assert.equal((await costs('missing')).complete,false);
 // Actual forward-patched seller call refresh consumes the collector at both
 // maturity boundaries. No fake signed outcome is needed for a negative trial.
 await q('truncate fixture_sources,icash_operation_spend,icash_credit_ledger,icash_usage_coverage');
 const key='voice:trial',question='Would you be interested in selling your property for all cash?';
 await q("insert into icash_learning_assignments values($1,'seller_calls',$2,'reviewed','*','cash_interest','shared-v1','explore',$3)",[id(1),id(100)+':contact',acquired]);
 await q("insert into icash_call_recordings(id,account_id,screening_id,party,operation_key,contact_key,created_at,call_context) values($1,$2,$3,'seller',$4,'contact',$5,$6)",[id(500),id(1),id(100),key,start,{strategyKey:'cash_interest',prompt:'REVIEWED INTEREST QUESTION (shared-v1/reviewed): '+question}]);
 await op(key,{at:start,cents:10});await source(key,{at:start});
 await op('progression:later',{at:after30,cents:20});await source('progression:later',{at:after30});
 await val('select icash_refresh_seller_call_learning($1)',[id(1)]);
 assert.equal(await val("select outcome_costs->'contracts'->'complete' from icash_learning_rollups where domain='seller_calls'"),false,'Disabled integration does not collect full account cost graphs');
 await q("update icash_learning_policy_private.outcome_cost_settings set installed_at=now()-interval '3 hours',enabled_at=now(),release_sha=repeat('a',40)");
 await val('select icash_refresh_seller_call_learning($1)',[id(1)]);
 const rollup=await val("select to_jsonb(r) from icash_learning_rollups r where domain='seller_calls'");
 assert.deepEqual([rollup.contract_trials,rollup.contracts,rollup.closing_trials,rollup.closings],[1,0,1,0]);
 assert.deepEqual([rollup.outcome_costs.contracts.costCents,rollup.outcome_costs.closings.costCents,rollup.outcome_costs.contracts.complete],[10,30,true],'Both real mature negative-trial denominators include matching costs');
 // Re-run through the complete production source graph, not its fixture adapter.
 await db.exec('drop function icash_learning_private.outcome_cost_sources(uuid)');
 await db.exec(read('tests/fixtures/outcome-cost-sources.sql'));
 for(const name of ['icash_dealmachine_request_started_at','icash_dealmachine_saved_owner_result_valid'])await db.exec(extract(read('config/dealmachine-dnc-observations.sql'),name));
 await db.exec(extract(read('config/owner-batch-contact-sources.sql'),'icash_dealmachine_owner_source_started_at'));
 await db.exec(read('config/outcome-cost-sources.sql'));
 await db.exec(read('config/outcome-cost-source-planning.sql'));
 await q('insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,$4),($5,$2,$6,$4)',[id(200),id(1),id(100),{address:'123 Fixture Street'},id(201),id(101)]);
 await q('insert into icash_title_search_results values($1,$2,$3,$4)',['progression:later',id(1),id(200),after30]);
 assert.deepEqual([(await costs()).costCents,(await costs('p1',60)).costCents,(await costs()).complete],[10,30,true],'Full source graph feeds the same canonical collector');
 // The real V6 consumer also keeps every mature negative trial and its own costs.
 const discovery='discovery:'+id(1)+':'+id(900)+':1';
 await q('update icash_screening_jobs set event_key=$1 where id=$2',[discovery+':p2',id(101)]);
 await q('insert into icash_discovery_inventory_receipts values($1,$2,$3,1,$4)',[discovery,id(1),['p2'],acquired]);
 await q('insert into icash_discovery_results values($1,$2,$3,$4)',[discovery,id(1),{rows:[{dm_property_id:'p2'}]},acquired]);
 await op(discovery,{at:acquired,cents:0});
 const textKey='text:'+id(800),textBody=await val("select icash_seller_cash_question('cash_sale_v6','123 Fixture Street')");
 await q("insert into icash_text_threads(id,account_id,deal_id,party,recipient) values($1,$2,$3,'seller','+12125550199')",[id(700),id(1),id(201)]);
 await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,body,provider_id,created_at,last_delivery_at) values($1,$2,$3,'outgoing','delivered',$4,'fixture-original-v6',$5,$5)",[id(800),id(700),id(1),textBody,start]);
 await q("insert into icash_seller_opener_assignments(thread_id,account_id,variant,body,created_at,message_id,delivered_at,opted_out,learning_context) values($1,$2,'cash_sale_v6',$3,$4,$5,$6,false,'cash-question-v6')",[id(700),id(1),textBody,acquired,id(800),start]);
 await op(textKey,{at:start,cents:5});
 await val('select icash_refresh_seller_interest_v6($1)',[id(1)]);
 const sms=await val("select to_jsonb(r) from icash_learning_rollups r where context='cash-question-v6'");
 assert.deepEqual([sms.attempts,sms.contract_trials,sms.contracts,sms.closing_trials,sms.closings,sms.outcome_costs.contracts.costCents,sms.outcome_costs.closings.costCents,sms.outcome_costs.contracts.complete],[1,1,0,1,0,5,5,true]);
 // Fault-inject one missing mature batch result into the real refresh. NULL
 // must not be ignored by bool_and while another property has complete costs.
 await q("insert into icash_screening_jobs(id,account_id,snapshot,created_at) values($1,$2,'{\"propertyId\":\"missing-window\"}',$3)",[id(102),id(1),acquired]);
 await q("insert into icash_learning_assignments values($1,'seller_calls',$2,'reviewed','*','cash_interest','shared-v1','explore',$3)",[id(1),id(102)+':contact',acquired]);
 await q("insert into icash_call_recordings(id,account_id,screening_id,party,operation_key,contact_key,created_at,call_context) values($1,$2,$3,'seller','voice:missing-window','contact',$4,$5)",[id(550),id(1),id(102),start,{strategyKey:'cash_interest',prompt:'REVIEWED INTEREST QUESTION (shared-v1/reviewed): '+question}]);
 await op('voice:missing-window',{at:start,cents:7});
 const batchDefinition=await val("select pg_get_functiondef('icash_learning_private.outcome_window_cost_batch(uuid,jsonb)'::regprocedure)");
 assert.equal(batchDefinition.split('order by b.trial_id;').length,2);
 await db.exec(batchDefinition.replace('order by b.trial_id;',"where b.property_id<>'missing-window' order by b.trial_id;"));
 await val('select icash_refresh_seller_call_learning($1)',[id(1)]);
 const missingWindow=await val("select to_jsonb(r) from icash_learning_rollups r where domain='seller_calls'");
 assert.deepEqual([missingWindow.contract_trials,missingWindow.outcome_costs.contracts.costCents,missingWindow.outcome_costs.contracts.complete,missingWindow.outcome_costs.contracts.providerCostsComplete],[2,10,false,false]);
 await db.exec(batchDefinition);await val('select icash_refresh_seller_call_learning($1)',[id(1)]);
 assert.equal(await val("select outcome_costs->'contracts'->'costCents' from icash_learning_rollups where domain='seller_calls'"),17);
 await q("delete from icash_learning_assignments where subject=$1",[id(102)+':contact']);await q('delete from icash_call_recordings where id=$1',[id(550)]);
 await q("delete from icash_operation_spend where operation_key='voice:missing-window'");await q("delete from icash_credit_ledger where event_key='usage:voice:missing-window'");
 await val('select icash_refresh_seller_call_learning($1)',[id(1)]);
 const overcap=Array.from({length:2001},(_,n)=>({property_id:'cap-'+n,started_at:start,window_days:30}));
 assert.equal(await val('select count(*)::int from icash_learning_private.outcome_window_cost_batch($1,$2)',[id(1),JSON.stringify(overcap)]),0,'Over-cap input does not collect a partial cohort');
 if(native&&process.env.ICASH_OUTCOME_SCALE_BOOTSTRAP!=='1'){
  // 1,001 actual mature properties yield 2,002 requested horizons. The real
  // consumer must retain all outcome trials and mark its omitted costs incomplete.
  await q("insert into icash_screening_jobs(id,account_id,snapshot,created_at) select md5('cap-screen:'||g)::uuid,$1,jsonb_build_object('propertyId','cap-property-'||g),$2::timestamptz from generate_series(1,1000) g",[id(1),acquired]);
  await q("insert into icash_learning_assignments select $1,'seller_calls',md5('cap-screen:'||g)::uuid||':contact','reviewed','*','cash_interest','shared-v1','explore',$2::timestamptz from generate_series(1,1000) g",[id(1),acquired]);
  await q("insert into icash_call_recordings(id,account_id,screening_id,party,operation_key,contact_key,created_at,call_context) select md5('cap-call:'||g)::uuid,$1,md5('cap-screen:'||g)::uuid,'seller','voice:cap:'||g,'contact',$2::timestamptz,$3::jsonb from generate_series(1,1000) g",[id(1),start,{strategyKey:'cash_interest',prompt:'REVIEWED INTEREST QUESTION (shared-v1/reviewed): '+question}]);
  await q("insert into icash_operation_spend(operation_key,account_id,state,created_at,dispatched_at,charged_cents,actual_micros,cost_basis,settled_at,settlement_evidence) select 'voice:cap:'||g,$1,'settled',$2::timestamptz,$2::timestamptz,0,0,'verified',$2::timestamptz,'fixture:explicit-zero' from generate_series(1,1000) g",[id(1),start]);
  await db.exec('analyze');
  await val('select icash_refresh_seller_call_learning($1)',[id(1)]);
  const cap=await val("select to_jsonb(r) from icash_learning_rollups r where domain='seller_calls'");
  assert.deepEqual([cap.attempts,cap.contract_trials,cap.closing_trials,cap.outcome_costs.contracts.complete,cap.outcome_costs.closings.complete],[1001,1001,1001,false,false]);
  await q("delete from icash_learning_assignments where subject in(select id::text||':contact' from icash_screening_jobs where snapshot->>'propertyId' like 'cap-property-%')");
  await q("delete from icash_call_recordings where operation_key like 'voice:cap:%'");await q("delete from icash_operation_spend where operation_key like 'voice:cap:%'");
  await q("delete from icash_screening_jobs where snapshot->>'propertyId' like 'cap-property-%'");await val('select icash_refresh_seller_call_learning($1)',[id(1)]);
 }
 await q("update icash_learning_policy_private.outcome_cost_settings set enabled_at=null");
 const shared=()=>val("select icash_shared_learning_stats('seller_calls','reviewed','*')");
 let stats=await shared();assert.equal(stats[0].outcome_costs.contracts.costs_complete,false,'Installed migration does not activate outcome learning');
 const release='a'.repeat(40);
 await q("update icash_learning_policy_private.settings set enabled=true,release_sha=$1,activated_at=now(),evidence_after=now()-interval '2 seconds'",[release]);
 await q("update icash_learning_private.policy_releases set release_sha=$1,completed_at=now()-interval '2 seconds',registered_at=now()",[release]);
 await q("update icash_learning_policy_private.outcome_cost_settings set installed_at=now()-interval '1 minute'");
 await q("update icash_learning_policy_private.settings set activated_at=now(),evidence_after=(select completed_at from icash_learning_private.policy_releases limit 1)");
 await assert.rejects(()=>val('select icash_activate_outcome_cost_learning($1,$2,true)',[id(11),release]));
 await val('select icash_activate_outcome_cost_learning($1,$2,true)',['592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',release]);
 stats=await shared();assert.equal(stats[0].outcome_costs.contracts.costs_complete,true);assert.equal(stats[0].outcome_costs.closings.effective_cost_cents,30);
 await q("update icash_learning_policy_private.settings set release_sha=$1",['b'.repeat(40)]);assert.equal((await shared())[0].outcome_costs.contracts.costs_complete,false,'Changed release immediately disables denominator qualification');
 // Pure SQL/TypeScript parity: a large 72h bill must not substitute for a cheap
 // contract window, and malformed optional evidence never gets coerced.
 const row=(variant,wins,cost)=>({variant,contributors:3,attempts:400,pending:0,positive:200,opted_out:0,contract_trials:400,contracts:wins,closing_trials:0,closings:0,cost_cents:1000,costs_complete:false,cost_scope:'seller-contact-72h-v1',updated_at:new Date(now).toISOString(),effective_attempts:400,effective_pending:0,effective_positive:200,effective_opted_out:0,effective_contract_trials:400,effective_contracts:wins,effective_closing_trials:0,effective_closings:0,effective_cost_cents:1000,outcome_costs:{scope:'property-outcome-costs-v1',contracts:{cost_cents:cost,effective_cost_cents:cost,effective_opted_out:0,costs_complete:true},closings:{cost_cents:0,effective_cost_cents:0,effective_opted_out:0,costs_complete:false}}});
 const compare=async input=>{const ts=sharedLearningDecision(input,['a','b']),sql=await val('select icash_learning_decision_v2($1,$2,false)',[JSON.stringify(input),['a','b']]);assert.deepEqual(sql,ts);return ts;};
 const good=[row('a',200,100),row('b',10,1000)];assert.equal((await compare(good)).winner,'a');assert.equal((await compare(good)).objective,'contracts');
 const bad=structuredClone(good);bad[0].outcome_costs.contracts.costs_complete=false;assert.equal((await compare(bad)).reason,'outcome_window_costs_incomplete');
 const wrong=structuredClone(good);wrong[0].outcome_costs.contracts.cost_cents=-1;assert.equal(sharedLearningStats(wrong).length,0);assert.equal((await compare(wrong)).reason,'insufficient_evidence');
 const missing=structuredClone(good);delete missing[0].outcome_costs;assert.equal((await compare(missing)).reason,'outcome_window_costs_incomplete');
 const free=structuredClone(good);free[0].outcome_costs.contracts.effective_cost_cents=0;assert.equal((await compare(free)).reason,'cost_evidence_incomplete');
 const closing=structuredClone(good);for(const [i,s] of closing.entries()){
  s.closing_trials=s.effective_closing_trials=400;s.closings=s.effective_closings=i?10:200;
  s.outcome_costs.closings={cost_cents:i?1:10000,effective_cost_cents:i?1:10000,effective_opted_out:0,costs_complete:true};
 }
 assert.deepEqual([(await compare(closing)).objective,(await compare(closing)).winner],['closings','b'],'The closing objective uses its 60-day cost, never the cheaper 30-day denominator');
 const malformedPenalty=structuredClone(good);malformedPenalty[0].outcome_costs.contracts.effective_opted_out=401;assert.equal((await compare(malformedPenalty)).reason,'insufficient_evidence');
 for(const sig of ['icash_learning_private.outcome_window_cost_batch(uuid,jsonb)','icash_learning_private.outcome_window_costs(uuid,text,timestamptz,integer)','public.icash_outcome_cost_learning_active()','public.icash_activate_outcome_cost_learning(uuid,text,boolean)']){
  for(const role of ['anon','authenticated'])assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,sig]),false);
  assert.equal(await val('select has_function_privilege(\'service_role\',$1,\'execute\')',[sig]),true);
 }
 console.log('Outcome window cost SQL: coverage, conservation, ambiguity, maturity, consumer integration, release gate and SQL/TS parity passed');
}catch(e){console.error(e.message,e.internalQuery??'',e.where??'');process.exitCode=1;}finally{await db.close();}
