// Real migration and queue/learning functions in isolated PostgreSQL. No providers.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {sellerInterestWinner,sellerInterestVariants} from '../lib/shared-learning.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration='supabase/migrations/20261023035406_seller_interest_experiments.sql';
assert.equal(read(migration),read('config/seller-interest-experiments.sql'));
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(read('tests/fixtures/shared-learning-schema.sql'));
 await db.exec(`create table icash_learning_cohorts(id uuid primary key);
 create table icash_operating_budget(id int primary key,enabled boolean);insert into icash_operating_budget values(1,true);
 create table icash_customer_identities(account_id uuid,principal text,company_name text);
 create table icash_seller_intakes(id uuid,phone text,name text);
 create table icash_sms_seller_openings(thread_id uuid primary key,account_id uuid,owner_question_id uuid,owner_reply_id uuid,interest_message_id uuid);
 create table icash_text_suppressions(phone text primary key);
 alter table icash_seller_opener_variants add primary key(key);
 alter table icash_seller_opener_variants alter column enabled set default true;
 alter table icash_seller_opener_assignments alter column created_at set default now();
 alter table icash_seller_opener_assignments alter column opted_out set default false;
 alter table icash_text_messages alter column id set default gen_random_uuid();
 alter table icash_text_messages alter column created_at set default now();
 create function icash_refresh_opportunity_outcomes(uuid) returns void language sql as $$select$$;
 create function icash_discovery_filter_feedback(uuid,text) returns jsonb language sql as $$select '[]'::jsonb$$;
 create function icash_save_buyer_search(uuid,uuid,uuid,integer,text,jsonb) returns void language sql as $$select$$;
 create function icash_prune_usage_loop_observations() returns integer language sql as $$select 0$$;
 create function icash_record_cost_observation(text,text,text,numeric,text) returns void language sql as $$select$$;
 -- Admission dependencies are fixture inputs. Existing SMS admission and budget
 -- suites exercise their complete implementations; this test runs the real queue.
 create function icash_outreach_sms_current(uuid) returns boolean language sql set search_path=public as $$select enabled from icash_operating_budget where id=1$$;
 create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql set search_path=public as $$select permission_until>now() from icash_text_threads where account_id=$1 and id=$2$$;
 create function icash_conversation_street(text) returns text language sql as $$select $1$$;
 create function icash_seller_contact_evidence(uuid,uuid,uuid,text) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function icash_seller_recipient_opener(uuid,uuid,text,text,text) returns text language sql as $$select 'Original inbound copy.'$$;
 create function icash_queue_text(uuid,uuid,uuid,text,uuid[]) returns uuid language plpgsql set search_path=public as $$declare message uuid;begin
 if exists(select 1 from icash_accounts where id=$1 and bot_paused) or not exists(select 1 from icash_wallets where account_id=$1 and balance_cents>0)
 or exists(select 1 from icash_text_threads t join icash_text_suppressions s on s.phone=t.recipient where t.id=$2) then raise exception 'Fixture admission hold';end if;
 insert into icash_text_messages(account_id,thread_id,direction,body,state) values($1,$2,'outgoing',$4,'ready') returning id into message;return message;end $$;
 insert into icash_seller_opener_variants(key,body) values('direct','Legacy direct'),('timing','Legacy timing');`);
 await db.exec(read('config/opportunity-score-bounds.sql'));
 const usage=read('config/usage-loop-tracking.sql');
 for(const name of ['icash_create_usage_loop_observation','icash_usage_loop_report'])await db.exec(usage.match(new RegExp('create function public\\.'+name+'\\([\\s\\S]*?end \\$\\$;'))[0]);
 for(let a=1;a<=4;a++){
  await q('insert into icash_accounts(id,owner_user_id,bot_paused) values($1,$1,false)',[id(a)]);
  await q('insert into icash_wallets(account_id,balance_cents) values($1,1000)',[id(a)]);
  await q("insert into icash_customer_identities values($1,'Fixture Investor',null)",[id(a)]);
 }
 for(const f of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.includes('_platform_shared_learning_')).sort())await db.exec(read('supabase/migrations/'+f));
 await db.exec(read('tests/fixtures/seller-opener-before-interest-experiments.sql'));
 await db.exec(read('config/seller-opener-delivery-order.sql'));
 await db.exec('create trigger opener_receipt after insert or update of state on icash_text_messages for each row execute function icash_observe_seller_opener();');
 await q("insert into icash_text_threads(id,account_id,party) values($1,$2,'seller')",[id(80),id(1)]);
 await q("insert into icash_seller_opener_assignments(thread_id,account_id,variant,body,message_id) values($1,$2,'direct','Historical saved copy',$3)",[id(80),id(1),id(81)]);
 await db.exec(read(migration));
 assert.equal(await val("select has_function_privilege('anon','icash_seller_sms_interest_at(uuid,uuid,timestamptz,timestamptz)','execute')"),false);
 assert.equal(await val("select has_function_privilege('authenticated','icash_seller_interest_winner(text[])','execute')"),false);
 assert.equal(await val("select has_function_privilege('service_role','icash_refresh_seller_interest(uuid)','execute')"),true);
 const makeThread=async(n,account=1,intake=null)=>{
  await q("insert into icash_screening_jobs(id,account_id,snapshot) values($1,$2,'{\"propertyId\":\"fixture\"}')",[id(n),id(account)]);
  await q("insert into icash_deal_files(id,account_id,screening_id,terms,stage) values($1,$2,$3,'{\"address\":\"123 Fixture St\"}','draft')",[id(n+1),id(account),id(n)]);
  await q("insert into icash_text_threads(id,account_id,deal_id,party,paused,ai_mode,permission_until,recipient,seller_intake_id) values($1,$2,$3,'seller',false,'auto',now()+interval '1 day','+12125550100',$4)",[id(n+2),id(account),id(n+1),intake]);
  return id(n+2);
 };
 const queue=(thread,account=1)=>val('select icash_queue_seller_opener($1,$2)',[id(account),thread]);
 const assign=(thread,account=1)=>val('select icash_assign_seller_opener($1,$2)',[id(account),thread]);
 assert.deepEqual(await assign(id(80)),{variant:'direct',body:'Historical saved copy',context:'opener-v1'},'Historical assignments are not rewritten or relabelled');
 const templates=(await q("select body from icash_seller_opener_variants where key=any($1)",[[...sellerInterestVariants]])).rows.map(r=>r.body);
 assert(templates.every(body=>body.length<=templates.find(body=>body.includes('possible cash offer')).length),'New copy must not shrink the existing address allowance');
 const bodies=new Set(),seen=new Set();
 for(let n=100;n<700;n+=10){const thread=await makeThread(n);const message=await queue(thread);assert(message);
  const a=await assign(thread);const body=await val('select body from icash_text_messages where id=$1',[message]);
  assert.equal(a.body,body);assert.equal(a.context,'interest-v2');assert(body.includes('the owner of 123 Fixture St?'));
  assert(!body.includes('STOP')&&!body.includes('{'));assert(body.length<=160);bodies.add(body);seen.add(a.variant);
  assert.equal(await queue(thread),null,'No second opener for an assigned thread');
 }
 assert.equal(bodies.size,3,'Every experiment must send distinct copy');assert.deepEqual([...seen].sort(),[...sellerInterestVariants].sort());
 const inbound=await makeThread(710,1,id(88));assert(await queue(inbound));
 assert.equal((await assign(inbound)).body,'Original inbound copy.');assert.equal((await assign(inbound)).context,'opener-v1');
 assert.equal(await queue(inbound,2),null,'Foreign account cannot queue');
 const held=await makeThread(720);await q('update icash_text_threads set paused=true where id=$1',[held]);assert.equal(await queue(held),null);
 await q("update icash_text_threads set paused=false,permission_until=now()-interval '1 minute' where id=$1",[held]);assert.equal(await queue(held),null);
 await q("update icash_text_threads set permission_until=now()+interval '1 day' where id=$1",[held]);
 await q('update icash_accounts set bot_paused=true where id=$1',[id(1)]);await assert.rejects(queue(held),/admission hold/);
 assert.equal(await val('select count(*)::int from icash_seller_opener_assignments where thread_id=$1',[held]),0,'Failed admission rolls assignment back');
 await q('update icash_accounts set bot_paused=false where id=$1',[id(1)]);
 await q('update icash_wallets set balance_cents=0 where account_id=$1',[id(1)]);await assert.rejects(queue(held),/admission hold/);await q('update icash_wallets set balance_cents=1000 where account_id=$1',[id(1)]);
 await q("insert into icash_text_suppressions values('+12125550100')");await assert.rejects(queue(held),/admission hold/);await q('delete from icash_text_suppressions');

 const thread=await makeThread(800),message=await queue(thread);
 const original=await assign(thread);
 await q("update icash_text_messages set created_at=now()-interval '1 hour',last_delivery_at=now()-interval '1 hour',state='delivered',provider_id='fixture-send' where id=$1",[message]);
 await q("insert into icash_operation_spend(operation_key,account_id,state,charged_cents) values($1,$2,'settled',2)",['text:'+message,id(1)]);
 const refresh=()=>val('select icash_refresh_learning_account($1)',[id(1)]);
 const stats=async()=>{await refresh();return val("select to_jsonb(r) from icash_learning_rollups r where account_id=$1 and domain='seller_sms' and context='interest-v2'",[id(1)]);};
 let s=await stats();assert.deepEqual([s.attempts,s.pending,s.positive,s.cost_cents,s.costs_complete],[1,1,0,2,true]);
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,body,state,provider_id,created_at) values($1,$2,$3,'incoming','yes','received','fixture-owner',now()-interval '55 minutes')",[id(810),id(1),thread]);
 assert.equal((await stats()).positive,0,'Ownership YES is not selling interest, even when first_reply_at exists');
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,body,state,created_at) values($1,$2,$3,'outgoing','Would you be interested in selling for cash?','ready',now()-interval '50 minutes')",[id(811),id(1),thread]);
 await q('update icash_sms_seller_openings set owner_reply_id=$1,interest_message_id=$2 where thread_id=$3',[id(810),id(811),thread]);
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,body,state,provider_id,created_at) values($1,$2,$3,'incoming','yes','received','fixture-interest',now()-interval '45 minutes')",[id(812),id(1),thread]);
 assert.equal((await stats()).positive,0,'Unsent question cannot establish selling interest');
 await q("update icash_text_messages set state='accepted',provider_id='fixture-question' where id=$1",[id(811)]);
 s=await stats();assert.deepEqual([s.pending,s.positive,s.costs_complete],[0,1,false],'Confirmed interest resolves immediately; a missing follow-up charge is incomplete');
 await q("insert into icash_operation_spend(operation_key,account_id,state,charged_cents) values($1,$2,'settled',2)",['text:'+id(811),id(1)]);
 assert.equal((await stats()).costs_complete,true);
 await q("update icash_text_messages set body='wrong number' where id=$1",[id(812)]);assert.equal((await stats()).positive,0);
 await q("update icash_text_messages set body='yes',provider_id=null where id=$1",[id(812)]);assert.equal((await stats()).positive,0,'Unreceipted incoming text does not win');
 await q("update icash_text_messages set provider_id='fixture-interest' where id=$1",[id(812)]);
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,body,state,provider_id,created_at) values($1,$2,$3,'incoming','How much?','received','fixture-between',now()-interval '46 minutes')",[id(813),id(1),thread]);
 assert.equal((await stats()).positive,0,'Ambiguous YES after another turn is not attributed');await q('delete from icash_text_messages where id=$1',[id(813)]);
 await q('update icash_text_messages set account_id=$1 where id=$2',[id(2),id(812)]);assert.equal((await stats()).positive,0);await q('update icash_text_messages set account_id=$1 where id=$2',[id(1),id(812)]);
 await q("update icash_text_messages set body='Different body' where id=$1",[message]);assert.equal(await stats(),undefined,'Changed actual copy excludes exposure');
 await q('update icash_text_messages set body=$1 where id=$2',[original.body,message]);
 await q("update icash_seller_opener_assignments set opted_out=true where thread_id=$1",[thread]);s=await stats();assert.deepEqual([s.pending,s.positive,s.opted_out],[0,0,1]);
 await q('update icash_seller_opener_assignments set opted_out=false where thread_id=$1',[thread]);
 await q("update icash_text_messages set body='maybe' where id=$1",[id(812)]);
 await q("insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,conversation_id,state,result,created_at,completed_at) values($1,$2,$3,'seller','fixture-call','fixture-conversation','complete','{\"interested\":true}',now()-interval '30 minutes',now()-interval '25 minutes')",[id(820),id(1),id(800)]);
 await q("insert into icash_call_recordings(account_id,screening_id,party,operation_key,to_phone,call_sid,created_at) values($1,$2,'seller','fixture-call','+12125550999','fixture-call-receipt',now()-interval '30 minutes')",[id(1),id(800)]);
 assert.equal((await stats()).positive,0,'Other phone call cannot reward this text');
 await q("update icash_call_recordings set to_phone='+12125550100' where operation_key='fixture-call'");s=await stats();assert.equal(s.positive,1);assert.equal(s.costs_complete,false);
 await q("insert into icash_operation_spend(operation_key,account_id,state,charged_cents) values('fixture-call',$1,'settled',25)",[id(1)]);s=await stats();assert.deepEqual([s.positive,s.cost_cents,s.costs_complete],[1,29,true]);
 await q("update icash_text_messages set body='yes' where id=$1",[id(812)]);
 await q("update icash_live_conversations set result='{\"interested\":true,\"optedOut\":true}' where operation_key='fixture-call'");
 s=await stats();assert.deepEqual([s.positive,s.opted_out,s.pending],[0,1,0],'A matched call refusal overrides earlier text interest');
 await q("update icash_live_conversations set result='{\"interested\":false}' where operation_key='fixture-call'");
 await q("update icash_seller_opener_assignments set delivered_at=now()-interval '4 days' where thread_id=$1",[thread]);
 await q("update icash_text_messages set created_at=now()-interval '4 days',last_delivery_at=now()-interval '4 days' where id=$1",[message]);
 s=await stats();assert.deepEqual([s.pending,s.positive],[0,0],'Unanswered work becomes a negative only after the receipt window');
 await q("update icash_text_messages set body='yes' where id=$1",[id(812)]);assert.equal((await stats()).positive,0,'Late interest does not contaminate a fixed comparison window');
 await q("update icash_deal_files set stage='under_contract' where id=$1",[id(801)]);s=await stats();assert.equal(s.contracts,0,'Stage labels cannot produce signed contracts');
 await q("update icash_text_messages set last_delivery_at=now() where id=$1",[message]);assert.equal((await stats()).pending,0,'A valid resolved positive is available even after a late delivery webhook');
 assert.equal(await val("select count(*)::int from icash_learning_rollups where account_id=$1 and domain='seller_sms' and context='opener-v1'",[id(1)]),0,'Historical reply labels are not recycled into new interest tests');

 await q("delete from icash_learning_rollups where domain='seller_sms'");
 for(let a=1;a<=3;a++)for(const variant of sellerInterestVariants){
  await q("insert into icash_learning_rollups(account_id,domain,context,market,variant,attempts,positive,cost_cents,costs_complete) values($1,'seller_sms','interest-v2','*',$2,100,$3,$4,true)",[id(a),variant,variant==='ownership_cash_v2'?40:variant==='ownership_timing_v2'?60:5,variant==='ownership_timing_v2'?20000:1000]);
 }
 const pooled=()=>val("select icash_shared_learning_stats('seller_sms','interest-v2','*')");
 const winner=()=>val('select icash_seller_interest_winner($1)',[[...sellerInterestVariants]]);
 assert.equal(await winner(),'ownership_cash_v2','Cost per interested seller beats raw response volume');assert.equal(sellerInterestWinner(await pooled()).variant,await winner());
 assert.deepEqual(await assign(thread),original,'Existing conversations keep their exact body despite new evidence');
 const allocations={};
 for(let n=1000;n<6000;n+=10){const th=await makeThread(n,4);const a=await assign(th,4);allocations[a.variant]=(allocations[a.variant]??0)+1;}
 assert(allocations.ownership_cash_v2>=250&&allocations.ownership_cash_v2<=350,'Winner gets approximately 60%, bounded by the deterministic bucket policy');
 assert(allocations.ownership_as_is_v2>=70&&allocations.ownership_timing_v2>=70,'Both challengers retain exploration');
 await q("update icash_learning_rollups set costs_complete=false where domain='seller_sms' and variant='ownership_cash_v2'");assert.equal(await winner(),null);assert.equal(sellerInterestWinner(await pooled()),null);
 await q("update icash_learning_rollups set costs_complete=true,pending=95 where domain='seller_sms'");assert.equal(await winner(),null,'Young attempts cannot qualify a winner');
 await q("update icash_learning_rollups set pending=0,opted_out=10 where domain='seller_sms' and variant='ownership_timing_v2'");assert.equal(await winner(),null);
 await q("update icash_learning_rollups set pending=0,opted_out=0,contract_trials=100,contracts=case when variant='ownership_as_is_v2' then 50 else 5 end where domain='seller_sms'");
 assert.equal(await winner(),'ownership_as_is_v2','Verified mature contract outcomes can supersede interest');assert.equal(sellerInterestWinner(await pooled()).variant,await winner());
 await q("update icash_seller_opener_variants set enabled=false where key=any($1)",[[...sellerInterestVariants]]);
 assert.deepEqual(await assign(thread),original,'Disabling new tests preserves existing assignments');
 const disabled=await makeThread(7000);assert.equal(await queue(disabled),null,'Disabled variants cannot start a new experiment');
 console.log('Seller interest experiments: distinct delivered copy, stable assignments, admission, source binding, immediate interest, receipt windows, complete costs, outcome priority, SQL/TS parity and bounded exploration passed.');
}catch(e){console.error(e.code?{message:e.message,code:e.code,where:e.where,query:e.query}:e);process.exitCode=1;}finally{await db.close();}
