import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setupSql,costsSetup,migration} from './helpers/cash-question-learning-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const db=new PGlite(),q=(sql,args=[])=>db.query(sql,args),val=async(sql,args=[])=>((v)=>v instanceof Date?v.toISOString():v)(Object.values((await q(sql,args)).rows[0]??{})[0]);
try{
 await db.exec(setupSql+costsSetup);
 await db.exec(migration);
 assert.equal(migration,read('supabase/migrations/20261114182940_cash_question_learning.sql'));
 const identityMigration=read('config/seller-assistant-identity.sql');
 const identityHelper=identityMigration.match(/create function public\.icash_seller_cash_assistant_reply\([\s\S]*?end \$\$;/)[0];
 const identityObserver=identityMigration.match(/do \$learning\$[\s\S]*?end \$learning\$;/)[0];
 await db.exec(identityHelper+identityObserver);

 assert.equal(await val('select icash_seller_cash_learning_active()'),false);
 const now=Date.parse(await val('select now()')),stamp=h=>new Date(now-h*3600000).toISOString(),plus=(at,m)=>new Date(Date.parse(at)+m*60000).toISOString();
 for(let a=1;a<=4;a++)await q("insert into icash_accounts(id,owner_user_id) values($1,$2)",[id(a),a===4?'592171a0-2bb9-484e-8c9a-dd5d2b43b5f7':id(a+10)]);
 const operation=async(key,at,{account=1,cents=2,state='settled',basis='verified'}={})=>q(`insert into icash_operation_spend(operation_key,account_id,state,created_at,dispatched_at,charged_cents,actual_micros,cost_basis,settled_at,settlement_evidence)
  values($1,$2,$3,$4,$4,$5,$6,$7,$8,'fixture:original')`,[key,id(account),state,at,cents,cents*10000,basis,plus(at,1)]);
 const exposure=async(n,hours,{variant='cash_sale_v6',account=1,property='fixture-'+n}={})=>{
  const at=stamp(hours),thread=id(n+2),message=id(n+3),address=n+' Fixture Street';
  await q("insert into icash_screening_jobs(id,account_id,event_key,snapshot) values($1,$2,'discovery:fixture',$3)",[id(n),id(account),{propertyId:property}]);
  await q("insert into icash_deal_files(id,account_id,screening_id,terms,stage) values($1,$2,$3,$4,'draft')",[id(n+1),id(account),id(n),{address}]);
  await q("insert into icash_text_threads(id,account_id,deal_id,party,sender,recipient) values($1,$2,$3,'seller','+12125550999','+12125550100')",[thread,id(account),id(n+1)]);
  await q("insert into icash_customer_identities values($1,'Fixture Buyer',null) on conflict do nothing",[id(account)]);
  const body=await val('select icash_seller_cash_question($1,$2)',[variant,address]);
  await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,body,provider_id,created_at,last_delivery_at) values($1,$2,$3,'outgoing','delivered',$4,$5,$6,$7)",[message,thread,id(account),body,'fixture:'+message,plus(at,-1),plus(at,1)]);
  await q("insert into icash_seller_opener_assignments(thread_id,account_id,variant,body,created_at,message_id,delivered_at,opted_out,learning_context) values($1,$2,$3,$4,$5,$6,$7,false,'cash-question-v6')",[thread,id(account),variant,body,plus(at,-2),message,plus(at,1)]);
  await operation('text:'+message,at,{account});return {n,at,thread,message,address,body,account};
 };
 const incoming=async(e,n,minutes,body='Yes')=>{await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,body,event_id,created_at) values($1,$2,$3,'incoming','received',$4,$5,$6)",[id(n),e.thread,id(e.account),body,'fixture:'+n,plus(e.at,minutes)]);
  await q("insert into icash_text_events(id,type,payload,received_at) values($1,'text.incoming.sms',$2,$3)",['fixture:'+n,{id:'fixture:'+n,type:'text.incoming.sms',timestamp:Date.parse(plus(e.at,minutes))/1000,data:{body,from:'+12125550100',to:'+12125550999'}},plus(e.at,minutes)]);
 };
 const stats=async(variant='cash_sale_v6')=>{await val('select icash_refresh_seller_interest_v6($1)',[id(1)]);return val("select to_jsonb(r) from icash_learning_rollups r where account_id=$1 and context='cash-question-v6' and variant=$2",[id(1),variant]);};
 const e=await exposure(100,74);const before=await val('select to_jsonb(a) from icash_seller_opener_assignments a where thread_id=$1',[e.thread]);
 await incoming(e,104,5);assert.equal(await val('select icash_seller_sms_interest_before_cash_learning($1,$2,$3,now())',[id(1),e.thread,e.at]),null);
 assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),e.thread,e.at]),plus(e.at,5),'Direct V6 yes now reaches canonical targeting/ranker labels');
 // Provider event time, not delayed ingestion, establishes a real response.
 await q("update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb($1::numeric)) where id='fixture:104'",[Date.parse(plus(e.at,-10))/1000]);
 assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),e.thread,e.at]),null,'Delayed old Yes is not a response to the new opener');
 await q("update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb($1::numeric)) where id='fixture:104'",[Date.parse(plus(e.at,5))/1000]);
 for(const timestamp of [null,'not-a-time',Date.parse(plus(e.at,5)),Date.now()/1000+3600]){
  await q("update icash_text_events set payload=jsonb_set(payload,'{timestamp}',$1::jsonb) where id='fixture:104'",[JSON.stringify(timestamp)]);
  assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),e.thread,e.at]),null,'Missing/invalid/future provider clock cannot teach');
 }
 await q("update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb($1::numeric)) where id='fixture:104'",[Date.parse(plus(e.at,5))/1000]);
 await q("update icash_text_events set payload=jsonb_set(payload,'{data,from}','\"+12125550101\"') where id='fixture:104'");
 assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),e.thread,e.at]),null,'Another number cannot provide this property response');
 await q("update icash_text_events set payload=jsonb_set(payload,'{data,from}','\"+12125550100\"') where id='fixture:104'");
 await q('update icash_text_messages set created_at=$2 where id=$1',[id(104),plus(e.at,15)]);
 assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),e.thread,e.at]),plus(e.at,5),'Returned label time is original receipt time');
 await q('update icash_text_messages set created_at=$2 where id=$1',[id(104),plus(e.at,5)]);
 let s=await stats();assert.deepEqual([s.attempts,s.pending,s.positive,s.cost_cents,s.costs_complete],[1,0,1,2,true]);
 assert.deepEqual(await val('select to_jsonb(a) from icash_seller_opener_assignments a where thread_id=$1',[e.thread]),before,'Derived labels never retrofit historical allocation proof');
 await q('update icash_text_messages set last_delivery_at=$2 where id=$1',[e.message,plus(e.at,10)]);
 assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),e.thread,e.at]),null,'Yes before actual delivery is not a reward');
 await q('update icash_text_messages set last_delivery_at=$2 where id=$1',[e.message,plus(e.at,1)]);
 for(const text of ['Who is this?','Depends on the offer',"What's the offer?",'Yes, if you pay a million dollars.']){await q('update icash_text_messages set body=$2 where id=$1',[id(104),text]);await q("update icash_text_events set payload=jsonb_set(payload,'{data,body}',to_jsonb($1::text)) where id='fixture:104'",[text]);assert.equal((await stats()).positive,0,text+' is not confirmed selling interest');}
 await q("update icash_text_messages set body='Yes' where id=$1",[id(104)]);await q("update icash_text_events set payload=jsonb_set(payload,'{data,body}','\"Yes\"') where id='fixture:104'");
 await incoming(e,105,10,'STOP');await q('update icash_text_messages set created_at=now() where id=$1',[id(105)]);s=await stats();assert.deepEqual([s.positive,s.opted_out],[0,1]);assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),e.thread,e.at]),null,'Later explicit refusal is also excluded at the canonical ranker boundary');await q('delete from icash_text_messages where id=$1',[id(105)]);
 // A real identity question followed by its exact approved cash question keeps attribution.
 const identity=await exposure(800,74,{variant:'cash_offer_v6'});await incoming(identity,804,5,'Who is this?');
 await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,body,provider_id,created_at,last_delivery_at) values($1,$2,$3,'outgoing','delivered',icash_seller_cash_identity_reply('Who is this?',$4),'fixture-identity',$5,$6)",[id(805),identity.thread,id(1),identity.address,plus(identity.at,6),plus(identity.at,8)]);
 await operation('text:'+id(805),plus(identity.at,7));
 await q("insert into icash_text_ai_jobs(id,account_id,thread_id,message_id,outgoing_id,state,analysis,created_at) values($1,$2,$3,$4,$5,'complete','{\"dialogueAction\":\"cash_identity_v6\"}',$6)",[id(806),id(1),identity.thread,id(804),id(805),plus(identity.at,5)]);
 await incoming(identity,807,10);
 assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),identity.thread,identity.at]),plus(identity.at,10));
 // Both exact approved identity bodies retain their original received/delivery
 // evidence. A wording migration must not erase old attribution or reward an
 // edited/unbound question.
 await q("update icash_text_messages set body=icash_seller_cash_assistant_reply('Who is this?',$2) where id=$1",[id(805),identity.address]);
 assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),identity.thread,identity.at]),plus(identity.at,10),'New assistant wording asks the same cash-sale question');
 await q("update icash_text_messages set body=body||' Changed.' where id=$1",[id(805)]);
 assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),identity.thread,identity.at]),null,'Unreviewed identity wording cannot teach');
 await q("update icash_text_messages set body=icash_seller_cash_assistant_reply('Who is this?',$2) where id=$1",[id(805),identity.address]);

 await q("update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb($1::numeric)) where id='fixture:804'",[Date.parse(plus(identity.at,-10))/1000]);
 assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),identity.thread,identity.at]),null,'Delayed old identity question cannot establish this sequence');
 await q("update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb($1::numeric)) where id='fixture:804'",[Date.parse(plus(identity.at,5))/1000]);
 await q("update icash_text_ai_jobs set analysis='{}' where id=$1",[id(806)]);assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),identity.thread,identity.at]),null,'An unbound identity reply cannot teach');
 await q("update icash_text_ai_jobs set analysis='{\"dialogueAction\":\"cash_identity_v6\"}' where id=$1",[id(806)]);
 await q('update icash_text_messages set last_delivery_at=$2 where id=$1',[id(805),plus(identity.at,11)]);assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),identity.thread,identity.at]),null,'Identity question must be delivered before Yes');
 await q('update icash_text_messages set last_delivery_at=$2 where id=$1',[id(805),plus(identity.at,8)]);
 // A prequeued question actually dispatched before Yes makes its meaning ambiguous.
 await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,body,provider_id,created_at,last_delivery_at) values($1,$2,$3,'outgoing','delivered','Are you the owner?','fixture-other',$4,$5)",[id(106),e.thread,id(1),plus(e.at,-2),plus(e.at,4)]);
 await operation('text:'+id(106),plus(e.at,3));assert.equal((await stats()).positive,0);
 await q('delete from icash_text_messages where id=$1',[id(106)]);await q('delete from icash_operation_spend where operation_key=$1',['text:'+id(106)]);
 const fresh=await exposure(200,2,{variant:'all_cash_v6'});await incoming(fresh,204,5);s=await stats('all_cash_v6');assert.deepEqual([s.attempts,s.pending,s.positive,s.cost_cents,s.costs_complete],[1,1,0,0,false],'Pending costs never dilute resolved-arm yield');
 await incoming(fresh,205,10,'STOP');s=await stats('all_cash_v6');assert.equal(s.opted_out,1,'Safety feedback is immediate even before response window maturity');
 // Provider dispatch, including failed/unconfirmed delivery, owns the trial.
 const failed=await exposure(500,74,{variant:'all_cash_v6'});
 await q("update icash_text_messages set state='needs_review',provider_id=null,last_delivery_at=null where id=$1",[failed.message]);
 await q('update icash_seller_opener_assignments set delivered_at=null where thread_id=$1',[failed.thread]);
 s=await stats('all_cash_v6');assert.deepEqual([s.attempts,s.pending,s.positive,s.cost_cents,s.costs_complete],[2,1,0,2,true],'Failed paid dispatch stays in attempts and mature costs');
 await q("update icash_operation_spend set cost_basis=null where operation_key=$1",['text:'+failed.message]);
 assert.equal((await stats('all_cash_v6')).costs_complete,false,'Unknown settlement blocks promotion even when delivery failed');
 await q("update icash_operation_spend set cost_basis='verified' where operation_key=$1",['text:'+failed.message]);
 const repeat=await exposure(300,73,{variant:'cash_offer_v6',property:'fixture-100'});await incoming(repeat,304,5);
 assert.equal((await stats('cash_offer_v6')).attempts,1,'One property has one first-exposure trial across variants');
 const owner=await exposure(400,74,{account:4});await incoming(owner,404,5);await val('select icash_refresh_seller_interest_v6($1)',[id(4)]);
 assert.equal(await val('select count(*)::int from icash_learning_rollups where account_id=$1',[id(4)]),0,'Owner/demo never teaches peers');
 // Standalone admitted call costs are included through the common full contact reader.
 await q("insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,conversation_id,created_at,completed_at) values($1,$2,$3,'seller','voice:unknown','fixture-live',$4,$5)",[id(600),id(1),id(100),plus(e.at,20),plus(e.at,21)]);
 s=await stats();assert.equal(s.costs_complete,false,'A call without a recording or settled cost cannot become free');
 await operation('voice:unknown',plus(e.at,20),{cents:5});s=await stats();assert.equal(s.cost_cents,9,'Duplicate property recipient costs and standalone calls all count');assert.equal(s.costs_complete,true);
 // Source-bound inbound refusals stay negative after normal transcript retention.
 const inbound=await exposure(900,74,{account:2});await incoming(inbound,904,5);
 const canonicalInbound=()=>val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(2),inbound.thread,inbound.at]);
 assert.equal(await canonicalInbound(),plus(inbound.at,5));
 const transcript=[{role:'agent',message:'Have you considered a cash sale?'},{role:'user',message:'Stop contacting me.'}];
 await q('insert into icash_seller_agreement_private.inbound_bindings(session_id,account_id,deal_id,thread_id) values($1,$2,$3,$4)',[id(905),id(2),id(901),inbound.thread]);
 await q("insert into icash_seller_agreement_private.call_history values($1,$2,$3,encode(sha256(convert_to('+12125550101','UTF8')),'hex'),'verified-inbound',$4,$5)",[id(905),id(2),id(900),plus(inbound.at,15),transcript]);
 assert.equal(await canonicalInbound(),plus(inbound.at,5),'Another contact negative cannot change this label');
 await q('delete from icash_seller_agreement_private.call_history where session_id=$1',[id(905)]);
 await q("insert into icash_seller_agreement_private.call_history values($1,$2,$3,encode(sha256(convert_to('+12125550100','UTF8')),'hex'),'verified-inbound',$4,$5)",[id(905),id(2),id(900),plus(inbound.at,15),transcript]);
 assert.equal(await canonicalInbound(),null);
 await q('delete from icash_seller_agreement_private.call_history where session_id=$1',[id(905)]);
 assert.equal(await canonicalInbound(),null,'Deleting expired transcript cannot resurrect prior interest');
 assert.equal(await val("select icash_learning_private.cash_inbound_disposition($1,$2,'+12125550100',$3,$4)",[id(2),id(900),inbound.at,plus(inbound.at,10)]),null,'Refusal remains bounded to its actual outcome window');
 assert.equal(await val("select has_table_privilege('service_role','icash_learning_private.cash_inbound_negatives','insert')"),false);
 await q("insert into icash_text_suppressions(phone,reason) values('+12125550100','Verified seller inbound_call opt-out: fixture')");
 assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),e.thread,e.at]),null,'Existing persistent contact opt-out is honored');
 await q("delete from icash_text_suppressions where phone='+12125550100'");
 // The ordered integration applies the same durable negatives to seller calls.
 const callAt=stamp(74),callScreen=id(1100),callThread=id(1102),contact='fixture-call-contact';
 await q("insert into icash_screening_jobs(id,account_id,event_key,snapshot) values($1,$2,'discovery:fixture','{\"propertyId\":\"call-property\"}')",[callScreen,id(3)]);
 await q("insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,'{}')",[id(1101),id(3),callScreen]);
 await q("insert into icash_text_threads(id,account_id,deal_id,party,sender,recipient) values($1,$2,$3,'seller','+12125550999','+12125550100')",[callThread,id(3),id(1101)]);
 await q("insert into icash_learning_assignments values($1,'seller_calls',$2,'reviewed','*','cash_interest','shared-v1','explore',$3)",[id(3),callScreen+':'+contact,plus(callAt,-2)]);
 await q("insert into icash_call_recordings(id,account_id,screening_id,party,operation_key,contact_key,to_phone,created_at,call_context) values($1,$2,$3,'seller','voice:integrated',$4,'+12125550100',$5,$6)",[id(1103),id(3),callScreen,contact,plus(callAt,1),{strategyKey:'cash_interest',prompt:'REVIEWED INTEREST QUESTION (shared-v1/reviewed): Have you considered a cash sale?'}]);
 await operation('voice:integrated',callAt,{account:3,cents:5});
 const callStats=async()=>{await val('select icash_refresh_seller_call_learning($1)',[id(3)]);return val("select to_jsonb(r) from icash_learning_rollups r where account_id=$1 and domain='seller_calls'",[id(3)]);};
 let call=await callStats();assert.deepEqual([call.attempts,call.positive,call.cost_cents,call.costs_complete],[1,0,5,true],'Unregistered dispatched call remains a mature paid negative');
 await q("insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,contact_key,conversation_id,state,created_at,completed_at,result) values($1,$2,$3,'seller','voice:integrated',$4,'conv-integrated','complete',$5,$6,$7)",[id(1104),id(3),callScreen,contact,plus(callAt,1),plus(callAt,3),{transcript:[{role:'agent',message:'Would you be interested in selling your property?'},{role:'user',message:'Yes'}]}]);
 assert.equal((await callStats()).positive,1);
 await q('insert into icash_seller_agreement_private.inbound_bindings values($1,$2,$3,$4)',[id(1105),id(3),id(1101),callThread]);
 await q("insert into icash_seller_agreement_private.call_history values($1,$2,$3,encode(sha256(convert_to('+12125550100','UTF8')),'hex'),'conv-inbound-integrated',$4,$5)",[id(1105),id(3),callScreen,plus(callAt,15),transcript]);
 call=await callStats();assert.deepEqual([call.positive,call.opted_out],[0,1],'Same source-bound inbound negative also suppresses call success');
 await q('delete from icash_seller_agreement_private.call_history where session_id=$1',[id(1105)]);
 assert.equal((await callStats()).positive,0,'Seller-call labels retain known refusal after transcript retention');
 // Enable only after the canonical exact release; stable control retains balanced exploration.
 await assert.rejects(val('select icash_activate_cash_question_learning($1,$2,true)',[id(1),'a'.repeat(40)]),/Owner required/);
 await assert.rejects(val('select icash_activate_cash_question_learning($1,$2,true)',['592171a0-2bb9-484e-8c9a-dd5d2b43b5f7','b'.repeat(40)]),/Canonical/);
 await assert.rejects(val('select icash_activate_cash_question_learning($1,$2,true)',['592171a0-2bb9-484e-8c9a-dd5d2b43b5f7','a'.repeat(40)]),/post-install/,'Preinstallation release proof cannot activate new allocation');
 await q('update icash_learning_private.policy_releases set completed_at=clock_timestamp(),registered_at=clock_timestamp()');
 await q('update icash_learning_policy_private.settings set activated_at=clock_timestamp(),evidence_after=clock_timestamp()');
 await val('select icash_activate_cash_question_learning($1,$2,true)',['592171a0-2bb9-484e-8c9a-dd5d2b43b5f7','a'.repeat(40)]);
 assert.equal(await val('select icash_seller_cash_learning_active()'),true);
 await val('select icash_activate_seller_contact_learning($1,$2,true)',['592171a0-2bb9-484e-8c9a-dd5d2b43b5f7','a'.repeat(40)]);
 assert.equal(await val('select icash_seller_contact_learning_active()'),true);
 await q('update icash_learning_policy_private.settings set activated_at=clock_timestamp(),evidence_after=clock_timestamp()');
 assert.equal(await val('select icash_seller_cash_learning_active()'),false);assert.equal(await val('select icash_seller_contact_learning_active()'),false);
 for(const fn of ['icash_activate_cash_question_learning','icash_activate_seller_contact_learning']){
  assert.equal((await val(`select ${fn}($1,$2,true)`,['592171a0-2bb9-484e-8c9a-dd5d2b43b5f7','a'.repeat(40)])).enabled,true);
 }
 assert.equal(await val('select icash_seller_cash_learning_active()'),true,'Same-SHA reactivation advances stale cutover');
 assert.equal(await val('select icash_seller_contact_learning_active()'),true,'Both activation receipts agree with actual active state');
 const cutoverSql="select jsonb_build_array((select enabled_at from icash_learning_policy_private.cash_learning_settings),(select enabled_at from icash_learning_policy_private.seller_contact_settings))";
 const cutovers=await val(cutoverSql);
 for(const fn of ['icash_activate_cash_question_learning','icash_activate_seller_contact_learning'])await val(`select ${fn}($1,$2,true)`,['592171a0-2bb9-484e-8c9a-dd5d2b43b5f7','a'.repeat(40)]);
 assert.deepEqual(await val(cutoverSql),cutovers,'Ordinary idempotent activation preserves original cutover proof');


 const prospective=await exposure(700,1);await q('delete from icash_seller_opener_assignments where thread_id=$1',[prospective.thread]);
 const plan=await val('select icash_seller_cash_question_plan($1,$2)',[id(1),prospective.thread]);assert(plan.decision);assert(['control','explore'].includes(plan.mode));
 await val('select icash_assign_seller_opener_v6($1,$2)',[id(1),prospective.thread]);
 assert.equal(await val('select learning_policy_version from icash_seller_opener_assignments where thread_id=$1',[prospective.thread]),'evidence-v2');
 assert.equal(await val("select count(*)::int from icash_learning_private.policy_applications where context='cash-question-v6'"),1,'Actual prospective assignment creates immutable application evidence');
 await assert.rejects(q("update icash_seller_opener_assignments set learning_decision_id=1 where thread_id=$1",[e.thread]),/immutable|relabelled/);
 // Actual evidence-v2 promotion reallocates only treatment; controls and challengers remain.
 for(const account of [1,2,3])for(const variant of ['cash_sale_v6','all_cash_v6','cash_offer_v6'])await q(`insert into icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete,cost_scope)
  values($1,'seller_sms','cash-question-v6','*',$2,200,0,$3,0,0,0,0,0,2000,true,'seller-contact-72h-v1')
  on conflict(account_id,domain,context,market,variant) do update set attempts=200,pending=0,positive=excluded.positive,opted_out=0,cost_cents=2000,costs_complete=true,updated_at=now()`,[id(account),variant,variant==='cash_sale_v6'?120:2]);
 assert.equal((await val('select icash_seller_cash_learning_report()')).decision.winner,'cash_sale_v6');
 await db.exec(`insert into icash_accounts(id,owner_user_id) select md5('account'||n)::uuid,md5('owner'||n)::uuid from generate_series(20,59)n;
  insert into icash_customer_identities select md5('account'||n)::uuid,'Fixture Buyer',null from generate_series(20,59)n;
  insert into icash_screening_jobs(id,account_id,event_key,snapshot) select md5('screen'||n||':'||p)::uuid,md5('account'||n)::uuid,'discovery:fixture',jsonb_build_object('propertyId','property'||n||':'||p) from generate_series(20,59)n cross join generate_series(1,10)p;
  insert into icash_deal_files(id,account_id,screening_id,terms,stage) select md5('deal'||n||':'||p)::uuid,md5('account'||n)::uuid,md5('screen'||n||':'||p)::uuid,'{"address":"123 Fixture Street"}','draft' from generate_series(20,59)n cross join generate_series(1,10)p;
  insert into icash_text_threads(id,account_id,deal_id,party,recipient) select md5('thread'||n||':'||p)::uuid,md5('account'||n)::uuid,md5('deal'||n||':'||p)::uuid,'seller','+12125550100' from generate_series(20,59)n cross join generate_series(1,10)p;`);
 const allocated=(await q(`select p->>'mode' mode,p->>'variant' variant,count(*)::int n from icash_text_threads t
  cross join lateral(select icash_seller_cash_question_plan(t.account_id,t.id)p)f
  where t.account_id not in ($1,$2,$3,$4) group by p->>'mode',p->>'variant'`,[id(1),id(2),id(3),id(4)])).rows;
 const chosen=(await q("select account_id,id from icash_text_threads where account_id not in ($1,$2,$3,$4) order by id limit 2",[id(1),id(2),id(3),id(4)])).rows;
 const expected=await val('select icash_seller_cash_question_plan($1,$2)',[chosen[0].account_id,chosen[0].id]);
 await val('select icash_assign_seller_opener_v6($1,$2)',[chosen[0].account_id,chosen[0].id]);
 const application=await val("select jsonb_build_object('variant',p.variant,'mode',p.mode,'winner',d.decision->>'winner') from icash_learning_private.policy_applications p join icash_learning_policy_private.decisions d on d.id=p.decision_id where p.source_key=$1",[chosen[0].id]);
 assert.deepEqual(application,{variant:expected.variant,mode:expected.mode,winner:'cash_sale_v6'},'Lifecycle receipt matches actual allocation and canonical evidence');
 const repeatedPlan=await val('select icash_seller_cash_question_plan($1,$2)',[id(1),prospective.thread]);assert.deepEqual(await val('select icash_seller_cash_question_plan($1,$2)',[id(1),prospective.thread]),repeatedPlan,'Same evidence and property deterministically choose same arm');
 const count=mode=>allocated.filter(v=>v.mode===mode).reduce((n,v)=>n+v.n,0),learned=count('shared'),control=count('control'),explore=count('explore');
 assert(control>=40&&control<=120&&explore>0&&learned>0,'Stable account holdout remains approximately20%');assert(learned/(learned+explore)>0.45&&learned/(learned+explore)<0.75,'Treatment keeps approximately60% winner allocation, not100%');
 assert(allocated.filter(v=>v.mode==='control').length===3,'Fixed controls retain every safe reviewed arm');
 // The full prior cost migration prevents72h costs from promoting30/60d outcomes.
 await q("update icash_learning_rollups set contract_trials=200,contracts=case when variant='cash_sale_v6' then 120 else 2 end where context='cash-question-v6'");
 assert.equal((await val('select icash_seller_cash_learning_report()')).decision.reason,'outcome_window_costs_incomplete');
 await q("update icash_learning_rollups set contract_trials=0,contracts=0 where context='cash-question-v6'");
 await q("update icash_learning_rollups set opted_out=30 where context='cash-question-v6' and variant='cash_sale_v6'");
 assert.notEqual((await val('select icash_seller_cash_question_plan($1,$2)',[id(1),prospective.thread])).variant,'cash_sale_v6','Unsafe winner is excluded immediately');
 await q("update icash_learning_rollups set opted_out=30 where context='cash-question-v6'");
 assert.equal(await val('select icash_seller_cash_question_plan($1,$2)',[id(1),prospective.thread]),null,'All unsafe arms do not fall back to an unsafe default');
 assert.equal(await val('select icash_assign_seller_opener_v6($1,$2)',[chosen[1].account_id,chosen[1].id]),null,'No new unsafe assignment is written');
 assert.equal(await val('select count(*)::int from icash_seller_opener_assignments where thread_id=$1',[chosen[1].id]),0);
 await val('select icash_activate_cash_question_learning($1,$2,false)',['592171a0-2bb9-484e-8c9a-dd5d2b43b5f7','a'.repeat(40)]);
 assert.equal(await val('select icash_seller_cash_learning_active()'),false);
 assert.equal(await val('select icash_seller_sms_interest_at($1,$2,$3,now())',[id(1),e.thread,e.at]),plus(e.at,5),'Rollback preserves factual interpretation of sent copy');
 for(const name of ['icash_learning_private.cash_inbound_disposition(uuid,uuid,text,timestamptz,timestamptz)','icash_learning_private.seller_sms_received_at(uuid,uuid,uuid)','icash_seller_cash_learning_report()','icash_seller_sms_interest_v6_at(uuid,uuid,timestamptz,timestamptz)','icash_activate_cash_question_learning(uuid,text,boolean)']){
  assert.equal(await val("select has_function_privilege('anon',$1,'execute')",[name]),false);assert.equal(await val("select has_function_privilege('authenticated',$1,'execute')",[name]),false);
 }
 await assert.rejects(db.exec(migration),/Cash question learning prerequisite changed/);await db.exec('rollback');
 console.log('PASS cash-question learning: canonical direct labels, actual dispatch/delivery clocks, complete property contact costs, immutable prospective decisions, mature windows, deduplication, current controls, exact-release activation and private ACLs.');
}catch(e){console.error('FAIL',e.message,e.detail??'',e.where??'',e.position??'');process.exitCode=1;}finally{await db.close();}
