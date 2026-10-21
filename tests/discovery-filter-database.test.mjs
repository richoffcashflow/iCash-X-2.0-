// Isolated PostgreSQL, synthetic rows, no provider requests or production writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=uuid(1),other=uuid(2),rate=uuid(3),revision=uuid(4);
const plan=(strategy='baseline',providerPage=1)=>({version:'seller-filters-v1',strategy,providerPage,mode:'explore'});
try{
await db.exec('create role anon;create role authenticated;create role service_role;');
await db.exec(read('tests/fixtures/opportunity-schema.sql'));
await db.exec(`
 create table icash_sms_seller_openings(thread_id uuid primary key,account_id uuid,interest_message_id uuid);
 create table icash_deal_emails(id uuid primary key,account_id uuid,deal_id uuid,direction text);
 create table icash_market_shortlist(zip text primary key,state text);
 create table icash_property_zip_geographies(zip text primary key,state_code text,property_count bigint,checked_at timestamptz,expires_at timestamptz);
 create function icash_seller_contact_stop(text) returns boolean language sql immutable as $$select lower(trim($1))='stop'$$;
 create function icash_research_state_allowed(text) returns boolean language sql immutable as $$select $1='TX'$$;
 create function icash_record_cost_observation(text,text,text,numeric,text) returns void language sql as $$insert into public.icash_cost_observations(provider,event_key,source_ref,amount,units) values($1,$2,$3,$4,$5) on conflict do nothing$$;
 create function icash_enqueue_screening(uuid,text,jsonb,timestamptz) returns uuid language sql as $$insert into public.icash_screening_jobs(account_id,event_key,snapshot) values($1,$2,$3) returning id$$;
 create function icash_rotate_inventory_market(uuid) returns boolean language sql as $$select false$$;
 -- Financial admission is an explicit fixture input; existing budget suites test
 -- its implementation. The actual production scope/claim wrapper runs below.
 create function icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) returns void language plpgsql as $$begin
 if exists(select 1 from public.icash_accounts where id=$1 and bot_paused) then raise exception 'Fixture budget hold';end if;
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until) values($2,$1,$3,gen_random_uuid(),50,100000,$4) on conflict do nothing;end$$;
 create function icash_claim_operation(text) returns boolean language plpgsql as $$begin update public.icash_operation_spend set state='dispatched',dispatched_at=now() where operation_key=$1 and state='reserved';return found;end$$;
`);
await db.exec(read('config/opportunity-engine.sql').split('-- Bayesian smoothing')[0]+'commit;');
await db.exec(read('tests/fixtures/filter-discovery-dependencies.sql'));
const admission=read('config/requested-property-zip-resolution.sql').match(/create or replace function public\.icash_reserve_and_claim_property_discovery\([\s\S]*?end \$\$;/)[0];
await db.exec(admission);
await db.exec(read('config/outbound-filter-experiments.sql'));
await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused) values($1,$1,'Fixture',false),($2,$2,'Other',false)",[account,other]);
await db.exec("insert into icash_operating_budget(id,enabled) values(1,true);insert into icash_market_shortlist values('75217','TX');");
await q("insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values($1,'property_search','fixture',50,'{}','SYNTHETIC',now(),now()+interval '10 days',true)",[rate]);
await q("insert into icash_discovery_configs(account_id,enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,next_page,revision) values($1,true,'75217',$3,10000,'2099-01-01',0,8,$4),($2,true,'75217',$3,10000,'2099-01-01',0,1,$4)",[account,other,rate,revision]);
const state=(a=account,r=revision,p=8)=>val('select icash_discovery_filter_state($1,$2,$3)',[a,r,p]);
assert.equal(await state(),null,'Schema rollout does not activate experiments');
await db.exec('update icash_discovery_filter_settings set enabled=true');
let s=await state();assert.equal(s.find(x=>x.strategy==='baseline').nextPage,8);assert.equal(s.find(x=>x.strategy==='vacant').nextPage,1);
await state(other,revision,1);await assert.rejects(state(other,uuid(44),1),/configuration changed/);
const op=p=>'discovery:'+account+':'+revision+':'+p;
const claim=(p,pl,a=account)=>val("select icash_reserve_and_claim_filtered_discovery($1,'75217',$2,$3,5,$4,10000,'2099-01-01',null,null,null,$5)",[a,revision,p,rate,pl]);
assert.equal(await claim(8,{...plan('baseline',8),arbitraryFilter:true}),false);
assert.equal(await claim(8,plan('invented',8)),false);
assert.equal(await claim(8,plan('baseline',7)),false);
assert.equal(await claim(8,plan('baseline',8),other),false,'Foreign cursor/config rejected');
await q('update icash_accounts set bot_paused=true where id=$1',[account]);await assert.rejects(claim(8,plan('baseline',8)),/budget hold/);
assert.equal(await val('select count(*)::int from icash_discovery_filter_pages'),0);await q('update icash_accounts set bot_paused=false where id=$1',[account]);
assert.equal(await claim(8,plan('baseline',8)),true);assert.equal(await claim(8,plan('baseline',8)),false,'Claim cannot replay');
const receipt=(pl,more=false,used=1)=>({filterPlan:pl,rows:[{dm_property_id:'prop_1',full_address:'Synthetic property',state:'TX',zip:'75217'}],creditsUsed:used,peopleCredits:0,estimatedCredits:1,hasNextPage:more,fetchedAt:new Date().toISOString()});
const save=(p,result,a=account)=>val('select icash_save_filtered_discovery($1,$2,$3,$4,$5)',[a,op(p),revision,p,result]);
const first=receipt(plan('baseline',8));
await assert.rejects(save(8,{...first,filterPlan:plan('vacant')}),/scope changed/);await assert.rejects(save(8,first,other),/operation required/);
assert.equal(await save(8,first),1);assert.equal(await save(8,first),1,'Identical receipt is idempotent');
await assert.rejects(save(8,{...first,creditsUsed:0}),/result conflict/);
s=await state(account,revision,9);assert.equal(s.find(x=>x.strategy==='baseline').exhausted,true);assert.equal(s.find(x=>x.strategy==='vacant').nextPage,1);
assert.equal(await val('select exhausted from icash_discovery_configs where account_id=$1',[account]),false,'One arm cannot exhaust the market');
assert.equal(await claim(9,plan('vacant')),true);await save(9,receipt(plan('vacant')));
assert.equal(await val('select count(*)::int from icash_screening_jobs where account_id=$1',[account]),1,'Overlapping filters do not enqueue duplicate outreach');
assert.equal(await val('select count(*)::int from icash_discovery_filter_attribution'),1,'Duplicate property cannot move to a different arm');
const empty=(p,pl,reason='empty')=>val('select icash_finish_empty_filter($1,$2,$3,$4,$5)',[account,revision,p,pl,reason]);
assert.equal(await empty(10,plan('absentee'),'unavailable'),true);assert.equal(await empty(10,plan('absentee'),'unavailable'),false);
assert.equal(await val('select next_page from icash_discovery_configs where account_id=$1',[account]),11);
assert.equal(await empty(11,plan('repairs')),true);assert.equal(await val('select exhausted from icash_discovery_configs where account_id=$1',[account]),true);
assert.equal(await val('select count(*)::int from icash_operation_spend'),2,'Free empty/unavailable estimates never reserve spend');
// Mature receipts and costs stay with their source arm, including wasted searches.
const screening=await val('select id from icash_screening_jobs where account_id=$1',[account]);
await q("update icash_screening_jobs set state='complete',result='{\"financialCheck\":{\"status\":\"eligible\"}}',completed_at=now() where id=$1",[screening]);
await db.exec("update icash_discovery_filter_pages set created_at=now()-interval '4 days';update icash_operation_spend set state='settled',charged_cents=5,actual_micros=10000,settled_at=now();");
await q("insert into icash_live_conversations(account_id,screening_id,party,agent_id,conversation_id,operation_key,contact_key,strategy_key,state,result,created_at,completed_at) values($1,$2,'seller','agent_fixture','conv_fixture','call:fixture','aaaaaaaaaaaaaaaa','cash_interest','complete',$3,now()-interval '4 days',now())",[account,screening,{transcript:[{role:'user',message:'Yes, I want to sell.'}],interested:true}]);
await q("insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until,state,charged_cents,actual_micros,settled_at) values('call:fixture',$1,$2,gen_random_uuid(),100,10000,'2099-01-01','settled',20,10000,now())",[account,rate]);
const refresh=async()=>{await q('delete from icash_opportunity_refreshes where account_id=$1',[account]);await q('select icash_refresh_opportunity_outcomes($1)',[account]);};
const stats=async()=>(await val("select icash_discovery_filter_stats($1,'75217')",[account])).sort((a,b)=>['baseline','vacant','absentee','repairs'].indexOf(a.strategy)-['baseline','vacant','absentee','repairs'].indexOf(b.strategy));
await refresh();let report=await stats();
assert.deepEqual(report.map(x=>[x.strategy,x.matureAttempts,x.interested,x.costCents]),[['baseline',1,1,25],['vacant',0,0,5],['absentee',0,0,0],['repairs',0,0,0]]);
assert((await val("select icash_discovery_filter_stats($1,'75217')",[other])).every(x=>x.interested===0&&x.costCents===0),'Learning is account-isolated');
await db.exec("update icash_live_conversations set created_at=now()");assert.equal((await stats())[0].matureAttempts,0,'A recent attempt is not a mature negative');
await db.exec("update icash_live_conversations set created_at=now()-interval '4 days';update icash_operation_spend set state='dispatched' where operation_key='call:fixture'");assert.equal((await stats())[0].costsComplete,false);
await db.exec("update icash_operation_spend set state='settled' where operation_key='call:fixture';update icash_live_conversations set result='{\"transcript\":[],\"interested\":false}'");
// A YES to ownership is not a YES to selling. Unsent questions cannot authorize evidence.
const deal=uuid(20),thread=uuid(21),question=uuid(22),reply=uuid(23);
await q("insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,'{}');",[deal,account,screening]);
await q("insert into icash_text_threads(id,account_id,deal_id,sender,recipient) values($1,$2,$3,'+12145550100','+12145550101')",[thread,account,deal]);
await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id,created_at) values($1,$3,$4,'outgoing','ready','Would you be interested in selling?',null,now()-interval '4 days'),($2,$3,$4,'incoming','received','yes','fixture_reply',now()-interval '3 days')",[question,reply,account,thread]);
const sms=()=>val('select icash_filter_sms_interest($1,$2)',[account,screening]);assert.equal(await sms(),false);
await q('insert into icash_sms_seller_openings values($1,$2,$3)',[thread,account,question]);assert.equal(await sms(),false);
await q("update icash_text_messages set state='delivered',provider_id='fixture_question' where id=$1",[question]);assert.equal(await sms(),true);
await q("update icash_text_messages set body='Yes, this is the owner' where id=$1",[reply]);assert.equal(await sms(),false);
await q("update icash_text_messages set body='yes' where id=$1",[reply]);await refresh();assert.equal((await stats())[0].interested,1);
await q("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id) values($1,$2,'incoming','received','STOP','fixture_stop')",[account,thread]);await refresh();assert.equal((await stats())[0].interested,0);assert.equal((await stats())[0].optedOut,1);
// No-owner previews free capacity; a held preview still counts as unfinished work.
const missing=uuid(30);await q("insert into icash_screening_jobs(id,account_id,event_key,snapshot,state,result) values($1,$2,'discovery:no-owner','{\"propertyId\":\"prop_30\"}','complete','{\"financialCheck\":{\"status\":\"eligible\"}}')",[missing,account]);
assert.equal(await val('select icash_pending_opportunity_count($1)',[account]),1);
await q("insert into icash_automation_tickets(account_id,kind,screening_id,state,outcome) values($1,'contacts',$2,'complete','empty')",[account,missing]);assert.equal(await val('select icash_pending_opportunity_count($1)',[account]),0);
await q("update icash_automation_tickets set state='held' where screening_id=$1",[missing]);assert.equal(await val('select icash_pending_opportunity_count($1)',[account]),1);
// Over-estimate usage preserves the original disable/reconciliation behavior.
await q('update icash_discovery_configs set revision=$2,next_page=1,exhausted=false where account_id=$1',[account,uuid(40)]);await state(account,uuid(40),1);
assert.equal(await val("select icash_reserve_and_claim_filtered_discovery($1,'75217',$2,1,5,$3,10000,'2099-01-01',null,null,null,$4)",[account,uuid(40),rate,plan()]),true);
const newOp='discovery:'+account+':'+uuid(40)+':1';await q('select icash_save_filtered_discovery($1,$2,$3,1,$4)',[account,newOp,uuid(40),receipt(plan(),true,2)]);
assert.equal(await val('select enabled from icash_discovery_configs where account_id=$1',[account]),false);
assert.equal(await val("select has_function_privilege('authenticated','icash_discovery_filter_state(uuid,uuid,integer)','execute')"),false);
assert.equal(await val("select count(*)::int from pg_class where relname like 'icash_discovery_filter_%' and relkind='r' and relrowsecurity"),4);
console.log('Filter database: real admission/save functions, cursor isolation, paid-claim idempotency, duplicate suppression, empty market handling, mature receipt-backed interest, costs, opt-outs and private permissions passed.');
}finally{await db.close();}
