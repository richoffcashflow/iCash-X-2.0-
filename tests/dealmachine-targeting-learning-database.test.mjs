import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {targetingLearningDecision} from '../lib/dealmachine-targeting-learning.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=id(1),other=id(2),revision=id(3),owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(read('tests/fixtures/targeting-schema.sql'));
 await db.exec(`
 create function icash_filter_sms_interest(uuid,uuid) returns boolean language sql as $$select false$$;
 create table fixture_signatures(account_id uuid,deal_id uuid,screening_id uuid,purchase_at timestamptz,assignment_at timestamptz,closed_at timestamptz);
 create function icash_learning_deal_outcomes(uuid) returns table(deal_id uuid,screening_id uuid,purchase_at timestamptz,assignment_at timestamptz,closed_at timestamptz) language sql as $$select deal_id,screening_id,purchase_at,assignment_at,closed_at from public.fixture_signatures where account_id=$1$$;
 create function icash_call_selling_interest(jsonb) returns boolean language sql as $$select $1->'explicitSellingInterest'='true'::jsonb$$;
 create function icash_call_has_seller_response(jsonb) returns boolean language sql as $$select $1->'sellerResponse'='true'::jsonb$$;
 create function icash_seller_contact_stop(text) returns boolean language sql as $$select upper(trim($1))='STOP'$$;
 create table fixture_sms_interest(account_id uuid,thread_id uuid,interest_at timestamptz);
 create function icash_seller_sms_interest_at(uuid,uuid,timestamptz,timestamptz) returns timestamptz language sql as $$select min(interest_at) from public.fixture_sms_interest where account_id=$1 and thread_id=$2 and interest_at between $3 and least($4,now())$$;
 create function icash_known_assigned_discovery_page(text,text,int,int) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_reserve_and_claim_property_discovery(uuid,text,uuid,int,int,uuid,bigint,timestamptz,int,text,text) returns boolean language plpgsql as $$begin insert into public.icash_operation_spend(operation_key,account_id,state) values('discovery:'||$1||':'||$3||':'||$4,$1,'dispatched');return true;end$$;
 create function icash_owner_active_export_enabled() returns boolean language sql as $$select true$$;
 create table icash_research_private.settings(id int,enabled boolean,exclusions_enabled boolean,pruned_at timestamptz);
 insert into icash_research_private.settings values(1,true,true,now());
 create function icash_dealmachine_capacity_available(int) returns boolean language sql as $$select true$$;
 `);
 for(const f of JSON.parse(read('tests/fixtures/targeting-exclusions-before.json')).filter(f=>f.proname!=='icash_reserve_research_discovery'))await db.exec(f.definition);
 for(const f of JSON.parse(read('tests/fixtures/targeting-before.json')).filter(f=>!['icash_prepare_research_efficiency','icash_record_discovery_inventory'].includes(f.proname)))await db.exec(f.definition);
 await db.exec(read('config/dealmachine-targeting-experiments.sql'));
 const original=await v("select pg_get_functiondef('icash_reserve_and_claim_filtered_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text,jsonb)'::regprocedure)");
 const patch=read('config/dealmachine-targeting-learning.sql');assert.equal(patch,read('supabase/migrations/20261104052232_dealmachine_targeting_learning.sql'));
 await db.exec(patch);
 assert.equal(await v("select pg_get_functiondef('icash_reserve_and_claim_filtered_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text,jsonb)'::regprocedure)"),original,'Original admission, locks, unknown-operation and money guards are untouched');
 assert.equal(await v('select enabled from icash_research_private.targeting_settings'),false);
 assert.equal(await v('select learning_started_at from icash_research_private.targeting_settings'),null);
 await q("insert into icash_discovery_configs(account_id,zip,revision,next_page,per_page,research_version,research_list_id) values($1,'75217',$2,1,25,2,'list-fixture')",[account,revision]);
 await db.exec("insert into icash_discovery_filter_settings(id,enabled) values(1,true);insert into icash_operating_budget(id) values(1);insert into icash_research_private.exclusions(id,list_id,state,last_synced_at) values(1,'list-fixture','ready',now());");
 const def={id:id(10),segment:'vacant_absentee',asOf:'2026-10-30'},strategy='target_'+def.id;
 const capability={status:'verified',checkedAt:new Date().toISOString(),plan:{name:'Fixture',is_paid:true},filters:['is_vacant_home','has_absentee_owners'].map(filter_id=>({filter_id,type:'BOOLEAN',allowed_operators:[],is_premium_filter:false}))};
 await q("insert into icash_integration_checks(provider,checked_at,result) values('dealmachine_targeting',now(),$1)",[capability]);
 await assert.rejects(v("select icash_configure_targeting($1,'set_enabled',null,true)",[other]),/Owner required/);
 await v("select icash_configure_targeting($1,'set_experiment',$2,true)",[owner,def]);
 await v("select icash_configure_targeting($1,'set_enabled',null,true)",[owner]);
 assert(await v('select learning_started_at is not null from icash_research_private.targeting_settings'));
 await db.exec("update icash_research_private.targeting_settings set learning_started_at=now()-interval '100 days';update icash_research_private.targeting_experiments set learning_started_at=now()-interval '100 days' where enabled;");
 const policy={version:'research-efficiency-v2',exclusionListId:'list-fixture'},learnedPlan={version:'seller-targeting-v1',strategy,providerPage:1,mode:'learned',targeting:def};
 assert.equal(await v('select icash_discovery_filter_plan_valid($1)',[learnedPlan]),true);
 assert.equal(await v('select icash_discovery_filter_plan_valid($1)',[{...learnedPlan,mode:'forced'}]),false);
 for(const arm of ['baseline',strategy]){
  const plan=arm==='baseline'?{version:'seller-filters-v1',strategy:arm,providerPage:1,mode:'explore'}:{...learnedPlan,mode:'explore'};
  await q(`insert into icash_discovery_filter_pages(operation_key,account_id,revision,sequence,zip,plan,state,created_at)
   select 'discovery:fixture:'||$1||':'||g,$2,$3,g,'75217',$4::jsonb||jsonb_build_object('providerPage',g),'complete',now()-interval '70 days' from generate_series(1,4) g`,[arm,account,revision,plan]);
  await q(`insert into icash_discovery_inventory_receipts(operation_key,account_id,per_page,query_policy,property_ids)
   select operation_key,account_id,25,$2,array[]::text[] from icash_discovery_filter_pages where plan->>'strategy'=$1`,[arm,policy]);
  await q(`insert into icash_operation_spend(operation_key,account_id,state,charged_cents,actual_micros,dispatched_at)
   select operation_key,account_id,'settled',75,250000,created_at from icash_discovery_filter_pages where plan->>'strategy'=$1`,[arm]);
  await q(`insert into icash_screening_jobs(id,account_id,state,result,created_at)
   select md5($1||':'||g)::uuid,$2,'complete','{"financialCheck":{"status":"eligible"}}',now()-interval '70 days' from generate_series(1,100) g`,[arm,account]);
  await q(`insert into icash_discovery_filter_attribution(screening_id,account_id,operation_key)
   select md5($1||':'||g)::uuid,$2,'discovery:fixture:'||$1||':'||(1+(g-1)/25) from generate_series(1,100) g`,[arm,account]);
  await q(`insert into icash_live_conversations(id,account_id,screening_id,party,conversation_id,operation_key,state,result,created_at,completed_at)
   select md5('voice:'||$1||':'||g)::uuid,$2,md5($1||':'||g)::uuid,'seller','provider:'||g,'voice:'||$1||':'||g,'complete',jsonb_build_object('sellerResponse',true,'interested',$1<>'baseline' and g<=50,'explicitSellingInterest',$1<>'baseline' and g<=50),now()-interval '69 days',now()-interval '69 days'+interval '5 minutes' from generate_series(1,100) g`,[arm,account]);
  await q(`insert into icash_operation_spend(operation_key,account_id,state,charged_cents,actual_micros,dispatched_at)
   select operation_key,account_id,'settled',10,50000,created_at from icash_live_conversations where operation_key like $1`,['voice:'+arm+':%']);
 }
 await q(`insert into fixture_signatures select $1,md5('deal:'||g)::uuid,md5($2||':'||g)::uuid,now()-interval '65 days',now()-interval '60 days',case when g<=20 then now()-interval '20 days' end from generate_series(1,30) g`,[account,strategy]);
 const evidence=()=>v('select icash_targeting_learning_evidence($1,\'75217\',$2)',[account,def.id]);
 let e=await evidence();assert.equal(e.baseline.matureAttempts,100);assert.equal(e.candidate.matureAttempts,100);assert.equal(e.candidate.interested,50);assert.equal(e.candidate.contracts,30);assert.equal(e.candidate.closings,20);assert.equal(e.candidate.costCents,1300);assert.equal(e.candidate.providerCostMicros,6000000);assert.equal(e.candidate.costsComplete,true);
 assert.equal(targetingLearningDecision(e,e.context,strategy).status,'candidate_supported');
 assert.equal(targetingLearningDecision(e,e.context,strategy).objective,'closings');
 const ambiguous='voice:'+strategy+':2';
 await q("update icash_live_conversations set result=result||'{\"explicitSellingInterest\":false}'::jsonb where operation_key=$1",[ambiguous]);assert.equal((await evidence()).candidate.interested,49,'Raw interested flag or owner confirmation alone never supplies selling interest');
 await q("update icash_live_conversations set result=result||'{\"explicitSellingInterest\":true}'::jsonb where operation_key=$1",[ambiguous]);
 assert.equal(await v('select icash_targeting_learning_evidence($1,\'75217\',$2)',[other,def.id]),null);
 assert.equal(await v('select icash_targeting_learning_evidence($1,\'90210\',$2)',[account,def.id]),null);
 // A paid operation with missing provider dollars, a wrong-account receipt or an
 // unfinished page must never create a cost-based winner.
 const call='voice:'+strategy+':1';
 await q('update icash_operation_spend set actual_micros=null where operation_key=$1',[call]);assert.equal((await evidence()).candidate.costsComplete,false);
 await q('update icash_operation_spend set actual_micros=50000,account_id=$2 where operation_key=$1',[call,other]);assert.equal((await evidence()).candidate.costsComplete,false);
 await q('update icash_operation_spend set account_id=$2 where operation_key=$1',[call,account]);
 const page='discovery:fixture:'+strategy+':1';
 await q("update icash_discovery_filter_pages set state='claimed' where operation_key=$1",[page]);e=await evidence();assert.equal(e.candidate.costsComplete,false);assert.equal(e.baseline.costsComplete,false);
 await q("update icash_discovery_filter_pages set state='complete' where operation_key=$1",[page]);
 // Different page sizes, query predicates, immutable definitions and pre-launch
 // pages are not concurrent comparison data.
 await q('update icash_discovery_inventory_receipts set per_page=5 where operation_key=$1',[page]);assert.equal((await evidence()).candidate.attempts,75);
 await q('update icash_discovery_inventory_receipts set per_page=25,query_policy=$2 where operation_key=$1',[page,{...policy,exclusionListId:'different'}]);assert.equal((await evidence()).candidate.attempts,75);
 await q('update icash_discovery_inventory_receipts set query_policy=$2 where operation_key=$1',[page,policy]);
 await q("update icash_discovery_filter_pages set created_at=now()-interval '120 days' where operation_key=$1",[page]);assert.equal((await evidence()).candidate.attempts,75);
 await q("update icash_discovery_filter_pages set created_at=now()-interval '70 days' where operation_key=$1",[page]);
 await q('update icash_discovery_inventory_receipts set operation_key=$2 where operation_key=$1',[page,'receipt-hidden']);assert.equal((await evidence()).baseline.costsComplete,false,'A missing original paid-page receipt blocks comparison even when other receipts exist');
 await q('update icash_discovery_inventory_receipts set operation_key=$1 where operation_key=$2',[page,'receipt-hidden']);
 // Late positive observations and immature exposures cannot enter fixed windows.
 await q("update icash_live_conversations set completed_at=now()-interval '65 days' where operation_key=$1",[call]);assert.equal((await evidence()).candidate.interested,49);
 await q('update icash_operation_spend set dispatched_at=now()-interval \'1 hour\' where operation_key=$1',[call]);e=await evidence();assert.equal(e.candidate.attempts,100);assert.equal(e.candidate.matureAttempts,99);
 await q('update icash_operation_spend set dispatched_at=null where operation_key=$1',[call]);assert.equal((await evidence()).candidate.attempts,99,'Unknown send clock does not become a mature negative');
 await q("update icash_operation_spend set dispatched_at=now()-interval '69 days' where operation_key=$1",[call]);
 // Accepted SMS uses its exact immutable dispatch operation, not created_at or a
 // later delivery update. The original timestamp helper remains the authority.
 const smsScreen=await v('select md5($1)::uuid',[strategy+':100']);
 await q("update icash_live_conversations set conversation_id=null where screening_id=$1",[smsScreen]);
 await q('insert into icash_deal_files(id,account_id,screening_id) values($1,$2,$3)',[id(50),account,smsScreen]);
 await q("insert into icash_text_threads(id,account_id,deal_id,party) values($1,$2,$3,'seller')",[id(51),account,id(50)]);
 await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,provider_id,created_at,updated_at,last_delivery_at) values($1,$2,$3,'outgoing','delivered','exact-sms',now()-interval '20 days',now(),now())",[id(52),id(51),account]);
 await q("insert into icash_operation_spend(operation_key,account_id,state,dispatched_at,charged_cents,actual_micros) values($1,$2,'settled',now()-interval '4 days',1,10000)",['text:'+id(52),account]);
 await q("insert into fixture_sms_interest values($1,$2,now()-interval '4 days'+interval '1 hour')",[account,id(51)]);
 e=await evidence();assert.equal(e.candidate.matureAttempts,100);assert.equal(e.candidate.interested,50,'Late webhook does not reset a mature original send; exact SMS positive enters its original window');
 await q("update icash_live_conversations set result=result||'{\"optedOut\":true}'::jsonb where operation_key like $1 and split_part(operation_key,':',3)::int<=6",['voice:'+strategy+':%']);
 e=await evidence();assert.equal(e.candidate.optedOut,6);assert.equal(targetingLearningDecision(e,e.context,strategy).hold,true);
 const started=await v('select learning_started_at::text from icash_research_private.targeting_settings');
 await v("select icash_configure_targeting($1,'set_enabled',null,false)",[owner]);assert.equal(await evidence(),null);
 await v("select icash_configure_targeting($1,'set_enabled',null,true)",[owner]);assert.equal(await v('select learning_started_at::text from icash_research_private.targeting_settings'),started,'Pause/resume never resets or relabels evidence');
 const state=await v('select icash_targeting_state($1,$2,1)',[account,revision]);assert.equal(state.experiments[0].learningEvidence.candidate.attempts,100);
 for(const role of ['anon','authenticated'])for(const signature of ['icash_targeting_learning_evidence(uuid,text,uuid)','icash_targeting_state(uuid,uuid,integer)','icash_targeting_report(uuid)','icash_configure_targeting(uuid,text,jsonb,boolean)'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 console.log('PASS targeting learning SQL: prospective concurrent scope, original exposures/costs, conversion windows, opt-out holds, private access and unchanged admission.');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await db.close();}
