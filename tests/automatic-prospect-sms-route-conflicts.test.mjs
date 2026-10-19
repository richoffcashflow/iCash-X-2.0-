// Local PostgreSQL simulation only. No provider requests or production writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const require=createRequire(import.meta.url);
const f=await createOperationalContactFixture(require.resolve('@electric-sql/pglite'),{automaticChannels:true});
const {pg,q,rpc,one,isolated,account,user,other,screening,deal,phone,sender,source,dnc,sms,sourceResult,prepare,project}=f;
const sql=readFileSync(new URL('../config/automatic-prospect-sms-route-conflicts.sql',import.meta.url),'utf8');
try{
 // Membership is an unchanged external gate; keep its value explicit in this fixture.
 await pg.exec(`create table prospect_fixture_membership(account_id uuid primary key,allowed boolean);
 create or replace function public.icash_membership_work_allowed(p_account uuid) returns boolean language sql stable as $$
 select coalesce((select allowed from public.prospect_fixture_membership where account_id=p_account),false)$$;`);
 // Load the actual existing state policy, without its unrelated rollout changes.
 const hybrid=readFileSync(new URL('../supabase/migrations/20261005183118_hybrid_inbound_priority_acquisition.sql',import.meta.url),'utf8');
 await pg.exec(hybrid.slice(hybrid.indexOf('create table public.icash_research_state_exclusions'),hybrid.indexOf('alter table public.icash_acquisition_policy')));
 await pg.exec(hybrid.match(/create function public\.icash_research_state_allowed[\s\S]*?\$\$;/)[0]);
 await q('insert into prospect_fixture_membership values($1,true)',[account]);
 // The baseline journey fixture predates the deployed cancellation stages.
 await pg.exec("alter table icash_deal_files drop constraint icash_deal_files_stage_check;alter table icash_deal_files add constraint icash_deal_files_stage_check check(stage in ('draft','under_contract','buyer_selected','title_open','closing','closed','cancellation_pending','cancelled'))");
 await q('delete from icash_deal_files where id=$1',[deal]);
 const snapshot={propertyId:'prop_1001',propertyType:'house',fetchedAt:new Date().toISOString(),raw:{data:{state:'TX'}}};
 const result={property:{propertyId:'prop_1001',address:'123 Main Street'},financialCheck:{status:'eligible'},cashOfferPriceCents:12300000};
 await q('update icash_screening_jobs set snapshot=$2,result=$3 where id=$1',[screening,snapshot,result]);
 // Current production routing schema and exact saved trigger/projector/sender functions.
 await pg.exec(`
 alter table icash_text_threads add column retired_at timestamptz,add column seller_intake_id uuid,add column owner_buyer_test_id uuid,add column sender_pool_assigned boolean not null default false;
 alter table icash_dnc_verification_receipts add column evidence_kind text not null default 'fixture';
 alter table icash_text_threads drop constraint icash_text_threads_sender_recipient_key;
 create unique index icash_text_threads_active_property_number on icash_text_threads(account_id,deal_id,sender,recipient) where retired_at is null and owner_buyer_test_id is null;
 create table icash_sms_routes(sender text,recipient text,account_id uuid,primary key(sender,recipient));
 create table icash_owner_buyer_tests(id uuid,thread_id uuid,account_id uuid,deal_id uuid,sender text,phone text,sms_rate_id uuid);
 create table icash_webinar_text_senders(phone text,preferred boolean);
 create table icash_webinar_phone_suppressions(phone text);
 create view icash_non_test_text_threads as select t.* from icash_text_threads t where not exists(select 1 from icash_owner_buyer_tests x where x.thread_id=t.id);
 create function icash_text_role_conflict(text,text) returns boolean language sql as $$select false$$;
 create function icash_owner_buyer_test_current(uuid) returns boolean language sql as $$select false$$;
 create function icash_seller_contact_evidence(uuid,uuid,uuid,text) returns jsonb language sql as $$select null::jsonb$$;
 `);
 await pg.exec(readFileSync(new URL('./fixtures/prospecting-sms-routing.sql',import.meta.url),'utf8'));
 await pg.exec('create trigger icash_00_sms_thread_binding before insert or update on icash_text_threads for each row execute function icash_sms_thread_binding()');
 const bindingBefore=await one("select pg_get_functiondef('icash_sms_thread_binding()'::regprocedure) definition");
 const priorScreen=await one("insert into icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at) values($1,'SIMULATION existing property','{\"propertyId\":\"prop_existing\"}','complete','{}',now()) returning id",[account]);
 const priorDeal=await one("insert into icash_deal_files(account_id,screening_id,terms) values($1,$2,'{\"address\":\"Existing property\"}') returning id",[account,priorScreen.id]);
 await pg.exec(readFileSync(new URL('../config/automatic-prospect-drafts.sql',import.meta.url),'utf8'));
 await isolated(async()=>{
  await q("insert into icash_text_threads(account_id,deal_id,sender,recipient,party) values($1,$2,$3,$4,'seller')",[account,priorDeal.id,sender,phone]);
  await assert.rejects(project(),/Separate assigned property consent required/,'reproduces production failure with real trigger');
 });
 // Restore the exact pre-359 function, as the emergency rollback does, then install the fix.
 await pg.exec(readFileSync(new URL('./fixtures/prospecting-sms-routing.sql',import.meta.url),'utf8'));
 await pg.exec(sql);
 assert.deepEqual(await one("select pg_get_functiondef('icash_sms_thread_binding()'::regprocedure) definition"),bindingBefore,'property binding guard unchanged');
 await isolated(async()=>{
  // Both candidates are initially routable. The first creates the pair in this
  // transaction; the locked recheck must skip the second without a rollback.
  await q('delete from icash_deal_files where id=$1',[priorDeal.id]);
  const nextSnapshot={...snapshot,propertyId:'prop_1002'};
  const nextResult={...result,property:{propertyId:'prop_1002',address:'456 Second Street'}};
  await q('update icash_screening_jobs set snapshot=$2,result=$3 where id=$1',[priorScreen.id,nextSnapshot,nextResult]);
  const nextOperation='owners:'+account+':'+priorScreen.id;
  const reservation=await one("insert into icash_credit_reservations(account_id,operation_key,amount_cents,status,settled_cents) values($1,$2,100,'settled',100) returning id",[account,nextOperation]);
  await q("insert into icash_operation_spend select (jsonb_populate_record(null::icash_operation_spend,to_jsonb(o)||jsonb_build_object('operation_key',$2::text,'credit_reservation_id',$3::uuid))).* from icash_operation_spend o where o.operation_key=$1",['owners:'+account+':'+screening,nextOperation,reservation.id]);
  await q('insert into icash_owner_contacts(account_id,screening_id,operation_key,result) values($1,$2,$3,$4)',[account,priorScreen.id,nextOperation,{...sourceResult,propertyId:'prop_1002'}]);
  await prepare();
  assert.equal(await project(),1,'same-batch competing properties retain just one unambiguous thread');
  assert.equal((await one('select count(*)::integer n from icash_deal_files where account_id=$1',[account])).n,1,'skipped same-batch property has no new draft');
  assert.equal(await project(),0,'same-batch conflict stays idempotently skipped');
 });
 await isolated(async()=>{
  const blocked=Array.from({length:100},(_,n)=>'+12145550'+String(n).padStart(3,'0'));
  const phones=[...blocked,phone];
  const nextSource=structuredClone(sourceResult);nextSource.contacts[0].phones=phones.map(number=>({number,doNotCall:false,permission:'unverified'}));
  await q('update icash_owner_contacts set result=$2 where screening_id=$1',[screening,nextSource]);
  for(const number of blocked){
   await q("insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,contact_timezone,timezone_source_reference) select source_id,$2,encode(sha256(convert_to($2,'UTF8')),'hex'),provider_reference||$2,encode(sha256(convert_to($2,'UTF8')),'hex'),checked_at,expires_at,clear,contact_timezone,timezone_source_reference from icash_dnc_verification_receipts where id=$1",[dnc,number]);
   await q("insert into icash_text_threads(account_id,deal_id,sender,recipient,party) values($1,$2,$3,$4,'seller')",[account,priorDeal.id,sender,number]);
  }
  await prepare();await prepare();
  assert.equal(await project(),1,'100 conflicting routes cannot starve a later eligible contact');
  assert.equal((await one('select count(*)::integer n from icash_text_threads t join icash_deal_files d on d.id=t.deal_id where d.screening_id=$1',[screening])).n,1);
  assert.equal((await one('select t.recipient from icash_text_threads t join icash_deal_files d on d.id=t.deal_id where d.screening_id=$1',[screening])).recipient,phone);
  assert.equal((await one('select count(*)::integer n from icash_text_threads where deal_id=$1',[priorDeal.id])).n,100,'existing conversations unchanged');
  assert.equal(await project(),0,'repeated automatic projection remains idempotent');
 });
 await q('delete from icash_deal_files where id=$1',[priorDeal.id]);
 await q('delete from icash_screening_jobs where id=$1',[priorScreen.id]);
 await isolated(async()=>{
  await q('insert into icash_sms_routes(sender,recipient,account_id) values($1,$2,$3)',[sender,phone,other]);
  assert.equal(await project(),0,'a durable route owned by another account cannot roll back all projection');
  assert.equal((await one('select count(*)::integer n from icash_deal_files where screening_id=$1',[screening])).n,0,'no draft created for another tenant route');
 });
 assert.equal(await prepare(),2);
 const noDraft=async()=>assert.equal((await one('select count(*)::integer n from icash_deal_files where account_id=$1',[account])).n,0);
 for(const [label,statement,args] of [
  ['manual Pause','update icash_accounts set bot_paused=true where id=$1',[account]],
  ['membership','update prospect_fixture_membership set allowed=false where account_id=$1',[account]],
  ['empty credits','update icash_wallets set balance_cents=0 where account_id=$1',[account]],
  ['billing review',"insert into icash_billing_reviews(event_id,payment_id,reason,account_id) values('SIMULATION event','SIMULATION payment','SIMULATION unresolved review',$1)",[account]],
  ['manual property',"insert into icash_property_controls(account_id,property_id,manual) values($1,'prop_1001',true)",[account]],
  ['stale screening',"update icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1",[screening]],
  ['future screening',"update icash_screening_jobs set completed_at=now()+interval '1 hour' where id=$1",[screening]],
  ['stale research',"update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{fetchedAt}',to_jsonb((now()-interval '25 hours')::text)) where id=$1",[screening]],
  ['future research',"update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{fetchedAt}',to_jsonb((now()+interval '1 hour')::text)) where id=$1",[screening]],
  ['malformed research time',"update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{fetchedAt}','\"not a date\"') where id=$1",[screening]],
  ['ineligible numbers',"update icash_screening_jobs set result=jsonb_set(result,'{financialCheck,status}','\"ineligible\"') where id=$1",[screening]],
  ['invalid property',"update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyType}','\"land\"') where id=$1",[screening]],
  ['mismatched property',"update icash_screening_jobs set result=jsonb_set(result,'{property,propertyId}','\"prop_9999\"') where id=$1",[screening]],
  ['practice',"update icash_screening_jobs set snapshot=snapshot||'{\"practice\":true}' where id=$1",[screening]],
  ['inbound source',"update icash_screening_jobs set snapshot=snapshot||'{\"sellerRequest\":{}}' where id=$1",[screening]],
  ['unsupported state',"update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{raw,data,state}','\"ZZ\"') where id=$1",[screening]],
  ['missing principal',"delete from icash_customer_identities where account_id=$1",[account]],
  ['DNC source disabled','update icash_dnc_verification_sources set enabled=false where id=$1',[source]],
  ['DNC not clear','update icash_dnc_verification_receipts set clear=false where id=$1',[dnc]],
  ['owner association missing',"update icash_owner_contacts set result=jsonb_set(result,'{contacts,0,likelyOwner}','false') where screening_id=$1",[screening]],
  ['opt-out',"insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[phone]],
  ['SMS provider rate disabled','update icash_operation_rates set enabled=false where id=$1',[sms]],
 ])await isolated(async()=>{await q(statement,args);assert.equal(await project(),0,label);await noDraft();});
 await isolated(async()=>{
  await rpc('icash_record_sms_inbound_campaign',{p_account:account,p_user:user,p_version:'sms-inbound-2026-09-30.1',p_accepted:true});
  await q('update icash_outreach_campaigns set enabled=false where account_id=$1',[account]);
  assert.equal(await project(),0,'explicit disabled channel');await noDraft();
 });
 await isolated(async()=>{
  // Deployed turnkey handoffs also support requests originating outside calls.
  await q('alter table icash_handoffs alter column conversation_id drop not null');
  await q("insert into icash_handoffs(account_id,screening_id,party,reason,summary,next_action) values($1,$2,'seller','SIMULATION requested human','SIMULATION handoff','SIMULATION review')",[account,screening]);
  assert.equal(await project(),0,'unresolved human handoff');await noDraft();
 });
 // Every preexisting deal wins, including archived or signed records.
 for(const stage of ['draft','under_contract','title_open','closing','closed','cancelled'])await isolated(async()=>{
  const saved=await one("insert into icash_deal_files(account_id,screening_id,stage,terms) values($1,$2,$3,'{\"seller\":\"User-entered seller\",\"priceCents\":9000000,\"priceSource\":\"seller_reported\"}') returning *",[account,screening,stage]);
  assert.equal(await project(),stage==='draft'?1:0,stage);
  assert.deepEqual(await one('select * from icash_deal_files where id=$1',[saved.id]),saved,'existing '+stage+' unchanged');
 });
 // Inject a manual save after the candidate SELECT, at the insert boundary.
 // This exercises the actual unique-key conflict path without a paid provider.
 await isolated(async()=>{
  await pg.exec(`create function public.prospect_fixture_manual_save() returns trigger language plpgsql as $$begin
   if new.terms->>'seller'='' then insert into public.icash_deal_files(account_id,screening_id,terms)
    values(new.account_id,new.screening_id,'{"seller":"Concurrent saved seller","priceCents":7654000,"priceSource":"seller_reported"}');end if;
   return new;end$$;
   create trigger prospect_fixture_manual_save before insert on public.icash_deal_files for each row execute function public.prospect_fixture_manual_save();`);
  assert.equal(await project(),1);
  const raced=await one('select terms from icash_deal_files where account_id=$1',[account]);
  assert.deepEqual(raced.terms,{seller:'Concurrent saved seller',priceCents:7654000,priceSource:'seller_reported'},'conflicting manual save wins unchanged');
 });
 // Overlapping requests also remain idempotent. PGlite serializes their SQL;
 // the conflict-path fixture above separately proves the manual-save boundary.
 assert.deepEqual((await Promise.all([project(),project(),project()])).sort(),[0,0,1]);
 const saved=await one('select * from icash_deal_files where account_id=$1 and screening_id=$2',[account,screening]);
 assert.equal(saved.stage,'draft');
 assert.deepEqual(saved.terms,{address:'123 Main Street',state:'TX',buyer:'SIMULATION business',seller:'',priceCents:null,priceSource:'proposed'});
 const thread=await one('select * from icash_text_threads where account_id=$1',[account]);
 assert.equal(thread.deal_id,saved.id);assert.equal(thread.paused,false);assert.equal(thread.ai_mode,'auto');
 for(const key of ['permission_until','permission_evidence','sms_review_request_id'])assert.equal(thread[key],null);
 assert.equal(await rpc('icash_project_operational_sms_contacts',{p_account:other}),0,'tenant scope');
 const message=await rpc('icash_queue_seller_opener',{p_account:account,p_thread:thread.id});assert(message,'automatic text can be queued without a user save');
 const queued=await one('select state,provider_id from icash_text_messages where id=$1',[message]);
 assert.equal(queued.state,'ready');assert.equal(queued.provider_id,null,'no provider send');
 assert.equal(await rpc('icash_queue_seller_opener',{p_account:account,p_thread:thread.id}),null,'opener remains idempotent');
 assert.equal((await one("select has_function_privilege('anon','public.icash_project_operational_sms_contacts(uuid)','EXECUTE') exposed")).exposed,false);
 assert.equal((await one("select has_function_privilege('authenticated','public.icash_project_operational_sms_contacts(uuid)','EXECUTE') exposed")).exposed,false);
 assert.equal(sql,readFileSync(new URL('../supabase/migrations/20261019165932_automatic_prospect_sms_route_conflicts.sql',import.meta.url),'utf8'),'committed migration equals tested SQL');
 assert.deepEqual((await one('select result from icash_owner_contacts where screening_id=$1',[screening])).result,sourceResult,'source evidence unchanged');
 assert.deepEqual((await one('select result from icash_screening_jobs where id=$1',[screening])).result,result,'cash offer and financial evidence unchanged');
 assert.equal((await one('select balance_cents,reserved_cents from icash_wallets where account_id=$1',[account])).balance_cents,100000,'preparation is free');
 assert.equal((await one('select count(*)::integer n from icash_contact_permissions')).n,0,'no fabricated permission');
 console.log('Automatic prospect route conflict recovery: real production binding trigger, 100 conflicting routes skipped before limit, source-bound eligibility, Pause/credits/membership/DNC, no-user-save SMS opener, unchanged existing deals, idempotence and no paid requests passed.');
}catch(error){console.error(error.message);console.error(error.where??'');console.error(error.query??'');process.exitCode=1;}finally{await pg.close();}
