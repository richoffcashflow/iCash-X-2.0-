import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {targetingFilters} from '../lib/dealmachine-targeting.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',account=id(1),other=id(2),revision=id(3);
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(read('tests/fixtures/targeting-schema.sql'));
 await db.exec(`
 create function icash_filter_sms_interest(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_learning_deal_outcomes(uuid) returns table(deal_id uuid,screening_id uuid,purchase_at timestamptz,assignment_at timestamptz,closed_at timestamptz) language sql as $$select null::uuid,null::uuid,null::timestamptz,null::timestamptz,null::timestamptz where false$$;
 create function icash_known_assigned_discovery_page(text,text,int,int) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_reserve_and_claim_property_discovery(uuid,text,uuid,int,int,uuid,bigint,timestamptz,int,text,text) returns boolean language plpgsql as $$begin insert into public.icash_operation_spend(operation_key,account_id,state) values('discovery:'||$1||':'||$3||':'||$4,$1,'dispatched');return true;end$$;
 create function icash_owner_active_export_enabled() returns boolean language sql as $$select true$$;
 `);
 for(const f of JSON.parse(read('tests/fixtures/targeting-before.json')).filter(f=>!['icash_prepare_research_efficiency','icash_record_discovery_inventory'].includes(f.proname)))await db.exec(f.definition);
 const sql=read('config/dealmachine-targeting-experiments.sql');assert.equal(sql,read('supabase/migrations/20261030183242_dealmachine_targeting_experiments.sql'));
 await db.exec(sql);
 await q("insert into icash_discovery_configs(account_id,zip,revision,next_page,per_page,research_version,research_list_id) values($1,'75217',$3,1,25,2,'list-fixture'),($2,'75217',$3,1,25,2,'list-fixture')",[account,other,revision]);
 await db.exec("insert into icash_discovery_filter_settings(id,enabled) values(1,true);insert into icash_operating_budget(id) values(1);insert into icash_research_private.exclusions(id,list_id,state,last_synced_at) values(1,'list-fixture','ready',now());");
 const def={id:id(10),segment:'vacant_absentee',asOf:'2026-10-30'};
 const capability={status:'verified',checkedAt:new Date().toISOString(),plan:{name:'Fixture',is_paid:true},filters:['is_vacant_home','has_absentee_owners'].map(filter_id=>({filter_id,type:'BOOLEAN',allowed_operators:[],is_premium_filter:false}))};
 await q("insert into icash_integration_checks(provider,checked_at,result) values('dealmachine_targeting',now(),$1)",[capability]);
 assert.equal(await v('select icash_targeting_state($1,$2,1)',[account,revision]),null);
 await assert.rejects(v('select icash_configure_targeting($1,\'set_enabled\',null,true)',[other]),/Owner required/);
 assert.equal(await v('select icash_configure_targeting($1,\'set_experiment\',$2,true)',[owner,def]),true);
 assert.equal(await v('select icash_configure_targeting($1,\'set_enabled\',null,true)',[owner]),true);
 const state=()=>v('select icash_targeting_state($1,$2,1)',[account,revision]);
 assert.equal((await state()).experiments.length,1);assert.equal((await state()).dedupReady,true);
 const plan={version:'seller-targeting-v1',strategy:'target_'+def.id,providerPage:1,mode:'explore',targeting:def};
 assert.equal(await v('select icash_discovery_filter_plan_valid($1)',[plan]),true);
 assert.equal(await v('select icash_discovery_filter_plan_valid($1)',[{...plan,arbitrary:true}]),false);
 await assert.rejects(v('select icash_configure_targeting($1,\'set_experiment\',$2,true)',[owner,{...def,segment:'off_market'}]),/Immutable/);
 for(const segment of ['sale_7_10','sale_10_plus','off_market','out_of_state_absentee','vacant_absentee','mobile']){
  const d={id:id(10),segment,asOf:'2024-02-29'};assert.deepEqual(await v('select icash_targeting_filters($1)',[d]),targetingFilters(d));
 }
 const buyer={id:id(11),segment:'buyer_fit',asOf:'2026-10-30',ranges:{num_bedrooms:{min:2,max:4}},buyerEvidence:{accountId:account,buyerId:id(12),sourceReference:'Synthetic dated buyer statement',observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),zips:['75217']}};
 assert.equal(await v('select icash_targeting_definition_valid($1)',[buyer]),true);
 assert.equal(await v('select icash_targeting_definition_valid($1)',[{...buyer,buyerEvidence:undefined}]),false);
 assert.equal(await v('select icash_targeting_definition_valid($1)',[{...buyer,ranges:{has_active_lien:{min:0,max:1}}}]),false);
 await q("insert into icash_research_private.exclusion_items(property_id) values('prop_99')");assert.equal((await state()).dedupReady,false);
 const claim=()=>v('select icash_reserve_and_claim_filtered_discovery($1,\'75217\',$2,1,25,$3,10000,\'2099-01-01\',null,null,null,$4)',[account,revision,id(4),plan]);
 assert.equal(await claim(),false,'Unsynced exclusions stop before a financial reservation');assert.equal(await v('select count(*)::int from icash_operation_spend'),0);
 await db.exec("update icash_research_private.exclusion_items set synced_at=now();insert into icash_discovery_inventory_receipts(operation_key,account_id,property_ids) values('old',$$00000000-0000-4000-8000-000000000001$$,array['prop_123']);");
 assert.equal((await state()).dedupReady,false,'Every acquired property must be covered, including a property from a different segment');
 await db.exec("insert into icash_research_private.exclusion_items(property_id,synced_at) values('prop_123',now())");
 assert.equal((await state()).dedupReady,true);
 assert.equal(await claim(),true);assert.equal(await claim(),false,'No replay of claimed work');
 assert.equal((await v('select icash_targeting_state($1,$2,1)',[other,revision])).dedupReady,false,'Global uncertain acquisition blocks a competing segment');
 await v('select icash_configure_targeting($1,\'set_enabled\',null,false)',[owner]);
 assert.equal(await v('select icash_targeting_cursor_available($1,$2,\'75217\',$3)',[account,revision,plan.strategy]),false);
 assert.equal(await v('select count(*)::int from icash_operation_spend'),1,'Rollback keeps the original financial hold');
 const report=await v('select icash_targeting_report($1)',[owner]);assert.equal(report.cohorts[0].costsComplete,false);assert.equal(report.cohorts[0].winnerDeclared,false);assert.equal(report.cohorts[0].qualifiedPerProviderDollar,null);
 for(const role of ['anon','authenticated'])for(const signature of ['icash_targeting_report(uuid)','icash_configure_targeting(uuid,text,jsonb,boolean)','icash_targeting_state(uuid,uuid,integer)','icash_owner_targeting_pools(uuid,uuid[])'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 console.log('PASS targeting SQL: immutable mapping, scoped buyers, dedup before spend, unknown holds, rollback, honest costs and private access.');
}catch(e){console.error(e.message,e.where??'',e.query?.slice(Math.max(0,Number(e.position)-120),Number(e.position)+120)??'');process.exitCode=1;}finally{await db.close();}
