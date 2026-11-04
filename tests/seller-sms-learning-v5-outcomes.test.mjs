// Synthetic source receipts and actual SQL functions; no provider requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('config/seller-sms-learning-v5-outcomes.sql');
assert.equal(migration,read('supabase/migrations/20261104053101_seller_sms_learning_v5_outcomes.sql'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const db=new PGlite(),q=(sql,args=[])=>db.query(sql,args),val=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const extract=(source,name)=>source.match(new RegExp('create (?:or replace )?function public\\.'+name+'\\([\\s\\S]*?(?:\\$\\$|\\$function\\$);','i'))?.[0];
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(read('tests/fixtures/shared-learning-schema.sql'));
 await db.exec(`alter table icash_seller_opener_assignments add column learning_context text,add column learning_decision_id bigint,add column learning_policy_version text,add column learning_selection_mode text;
 create table icash_sms_seller_openings(thread_id uuid primary key,account_id uuid,owner_question_id uuid,owner_reply_id uuid,interest_message_id uuid);
 create table icash_text_ai_jobs(id uuid primary key,account_id uuid,thread_id uuid,message_id uuid,state text,provider_id text,usage jsonb,created_at timestamptz);
 create table icash_learning_rollups(account_id uuid,domain text,context text,market text,variant text,attempts bigint,pending bigint,positive bigint,opted_out bigint,contract_trials bigint,contracts bigint,closing_trials bigint,closings bigint,cost_cents bigint,costs_complete boolean,updated_at timestamptz default now(),primary key(account_id,domain,context,market,variant));`);
 for(const name of ['icash_learning_signature_verified','icash_learning_deal_outcomes'])await db.exec(extract(read('config/platform-shared-learning.sql'),name));
 await db.exec(read('config/seller-response-policy.sql'));await db.exec(read('config/seller-optout-base-verbs.sql'));
 await db.exec(extract(read('supabase/migrations/20261023175907_seller_call_contact_evidence.sql'),'icash_call_has_seller_response'));
 for(const name of ['icash_seller_interest_quote','icash_call_selling_interest'])await db.exec(extract(read('config/seller-interest-evidence.sql'),name));
 await db.exec(read('config/seller-interest-reviewed-question.sql'));
 await db.exec(extract(read('config/seller-interest-experiments.sql'),'icash_seller_sms_interest_at'));
 const legacy=extract(read('config/seller-interest-experiments.sql'),'icash_refresh_seller_interest').replace("c.result->'interested'='true'::jsonb",'public.icash_call_selling_interest(c.result)');
 await db.exec(legacy);
 await db.exec(extract(read('config/seller-sms-learning-v5.sql'),'icash_seller_sms_learning_eligible'));
 await db.exec('revoke all on function icash_refresh_seller_interest(uuid) from public,anon,authenticated;grant execute on function icash_refresh_seller_interest(uuid) to service_role;');
 const originalLegacy=await val("select pg_get_functiondef('icash_refresh_seller_interest(uuid)'::regprocedure)");
 assert.equal(await val("select md5(pg_get_functiondef('icash_refresh_seller_interest(uuid)'::regprocedure))"),'05e319c36da14ddb129b9b3859d05bbe');
 await db.exec(originalLegacy.replace('AS $function$\n','AS $function$\n-- unreviewed drift\n'));
 await assert.rejects(db.exec(migration),/Seller legacy interest refresh changed/);await db.exec('rollback');
 assert.equal(await val("select to_regprocedure('icash_refresh_seller_interest_v5(uuid)')"),null,'Drift rejects the complete forward transaction');
 await db.exec(originalLegacy);await db.exec(migration);
 const currentLegacy=await val("select pg_get_functiondef('icash_refresh_seller_interest(uuid)'::regprocedure)");
 assert.equal(currentLegacy.replace(' select public.icash_refresh_seller_interest_v5(p_account);\n',''),originalLegacy,'Legacy code is byte-identical apart from the new-context call');
 for(const name of ['icash_seller_sms_interest_v5_at(uuid,uuid,timestamptz,timestamptz)','icash_refresh_seller_interest_v5(uuid)','icash_refresh_seller_interest(uuid)']){
  assert.equal(await val(`select has_function_privilege('anon',$1,'execute')`,[name]),false);
  assert.equal(await val(`select has_function_privilege('authenticated',$1,'execute')`,[name]),false);
  assert.equal(await val(`select has_function_privilege('service_role',$1,'execute')`,[name]),true);
 }
 const now=Date.parse(await val('select now()'));
 const stamp=hours=>new Date(now-hours*3600000).toISOString();
 const offset=(at,minutes)=>new Date(Date.parse(at)+minutes*60000).toISOString();
 for(let a=1;a<=4;a++)await q('insert into icash_accounts(id,owner_user_id) values($1,$2)',[id(a),a===3?'592171a0-2bb9-484e-8c9a-dd5d2b43b5f7':id(a+10)]);
 const operation=async(key,at,{account=1,cents=2,state='settled',basis='verified',dispatch=at}={})=>q(`insert into icash_operation_spend(operation_key,account_id,state,created_at,dispatched_at,charged_cents,actual_micros,cost_basis,settled_at,settlement_evidence)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,'fixture:original-settlement')`,[key,id(account),state,offset(at,-0.5),dispatch,cents,cents*10000,basis,offset(at,0.5)]);
 const exposure=async(n,hours,variant='identity_cash_v5',account=1)=>{
  const at=stamp(hours),thread=id(n+2),message=id(n+3);
  await q("insert into icash_screening_jobs(id,account_id,event_key,snapshot) values($1,$2,'discovery:fixture',$3)",[id(n),id(account),{propertyId:'fixture-'+n}]);
  await q("insert into icash_deal_files(id,account_id,screening_id,terms,stage) values($1,$2,$3,'{}','draft')",[id(n+1),id(account),id(n)]);
  await q("insert into icash_text_threads(id,account_id,deal_id,party,recipient) values($1,$2,$3,'seller','+12125550100')",[thread,id(account),id(n+1)]);
  const body=`Hi, contacting you for Fixture Investor about a cash offer. Do you own ${n} Fixture Street?`;
  await q(`insert into icash_text_messages(id,thread_id,account_id,direction,state,body,provider_id,created_at,last_delivery_at)
   values($1,$2,$3,'outgoing','delivered',$4,$5,$6,$7)`,[message,thread,id(account),body,'fixture:'+message,offset(at,-1),offset(at,1)]);
  await q(`insert into icash_seller_opener_assignments(thread_id,account_id,variant,body,created_at,message_id,delivered_at,opted_out,learning_context,learning_decision_id,learning_policy_version,learning_selection_mode)
   values($1,$2,$3,$4,$5,$6,$7,false,'identity-v5',1,'evidence-v2','explore')`,[thread,id(account),variant,body,offset(at,-2),message,offset(at,1)]);
  await q('insert into icash_sms_seller_openings(thread_id,account_id,owner_question_id) values($1,$2,$3)',[thread,id(account),message]);
  await operation('text:'+message,at,{account});return {n,at,thread,message,body,account};
 };
 const incoming=async(e,n,minutes,body='Yes')=>q(`insert into icash_text_messages(id,thread_id,account_id,direction,state,body,event_id,created_at)
  values($1,$2,$3,'incoming','received',$4,$5,$6)`,[id(n),e.thread,id(e.account),body,'fixture:'+n,offset(e.at,minutes)]);
 const refresh=()=>val('select icash_refresh_seller_interest_v5($1)',[id(1)]);
 const stats=async(variant='identity_cash_v5')=>{await refresh();return val("select to_jsonb(r) from icash_learning_rollups r where account_id=$1 and context='identity-v5' and variant=$2",[id(1),variant]);};
 const e=await exposure(100,73);
 let s=await stats();assert.deepEqual([s.attempts,s.pending,s.positive,s.cost_cents,s.costs_complete],[1,0,0,2,true]);
 await incoming(e,104,5);await q('update icash_sms_seller_openings set owner_reply_id=$1 where thread_id=$2',[id(104),e.thread]);
 assert.equal((await stats()).positive,0,'Ownership confirmation is never a reward');
 await q(`insert into icash_text_messages(id,thread_id,account_id,direction,state,body,created_at)
  values($1,$2,$3,'outgoing','ready','Would you be interested in selling your property for all cash?',$4)`,[id(105),e.thread,id(1),offset(e.at,10)]);
 await q('update icash_sms_seller_openings set interest_message_id=$1 where thread_id=$2',[id(105),e.thread]);await incoming(e,106,15);
 assert.equal((await stats()).positive,0);
 await q("update icash_text_messages set state='accepted',provider_id='fixture-question' where id=$1",[id(105)]);
 assert.equal((await stats()).positive,0,'Acceptance alone is not delivered question evidence');
 await q("update icash_text_messages set state='delivered',last_delivery_at=$2 where id=$1",[id(105),offset(e.at,12)]);
 assert.equal((await stats()).positive,0,'Missing canonical dispatch cannot bind an answer');
 assert.equal((await stats()).costs_complete,false,'Missing original send cost is incomplete');
 await operation('text:'+id(105),offset(e.at,11));
 s=await stats();assert.deepEqual([s.pending,s.positive,s.cost_cents,s.costs_complete],[0,1,4,true]);
 await q('update icash_operation_spend set dispatched_at=$2 where operation_key=$1',['text:'+id(105),offset(e.at,20)]);
 await q('update icash_text_messages set last_delivery_at=$2 where id=$1',[id(105),offset(e.at,21)]);
 assert.equal((await stats()).positive,0,'A reply to a queued question before actual dispatch cannot win');
 await q('update icash_operation_spend set dispatched_at=$2 where operation_key=$1',['text:'+id(105),offset(e.at,11)]);
 assert.equal((await stats()).positive,1,'Late delivery receipt does not re-time the actual question');
 await q("update icash_text_messages set body='Are you the owner?' where id=$1",[id(105)]);assert.equal((await stats()).positive,0,'A bad interest_message pointer cannot turn ownership into interest');
 await q("update icash_text_messages set body='Would you be interested in selling your property for all cash?' where id=$1",[id(105)]);
 await q("update icash_text_messages set body='Yes, if you pay a million dollars.' where id=$1",[id(106)]);assert.equal((await stats()).positive,0);
 await q("update icash_text_messages set body='Yes' where id=$1",[id(106)]);
 await incoming(e,107,14,'How much?');assert.equal((await stats()).positive,0,'Intervening turns prevent ambiguous attribution');await q('delete from icash_text_messages where id=$1',[id(107)]);
 await q(`insert into icash_text_messages(id,thread_id,account_id,direction,state,body,provider_id,created_at,last_delivery_at)
  values($1,$2,$3,'outgoing','delivered','Are you the owner?','fixture-intervening',$4,$5)`,[id(109),e.thread,id(1),offset(e.at,-1),offset(e.at,14)]);
 await operation('text:'+id(109),offset(e.at,13));
 assert.equal((await stats()).positive,0,'A prequeued question actually sent between the selling question and Yes invalidates attribution');
 await q('delete from icash_operation_spend where operation_key=$1',['text:'+id(109)]);
 assert.equal(await val('select icash_seller_sms_interest_v5_at($1,$2,$3,now())',[id(1),e.thread,e.at]),null,'An intervening delivery with missing dispatch remains ambiguous');
 assert.equal(await stats(),undefined,'A known older queued send with an unknown clock cannot be assumed fresh exposure');
 await q('delete from icash_text_messages where id=$1',[id(109)]);
 await incoming(e,108,25,'Stop calling me.');s=await stats();assert.deepEqual([s.positive,s.opted_out,s.pending],[0,1,0]);
 await q("update icash_text_messages set body='No thanks' where id=$1",[id(108)]);s=await stats();assert.deepEqual([s.positive,s.opted_out,s.pending],[0,0,0],'Refusal is a negative, not permanent opt-out');await q('delete from icash_text_messages where id=$1',[id(108)]);

 // All incurred contact costs count, including AI and uncertain carrier work.
 await q("insert into icash_text_ai_jobs(id,account_id,thread_id,state,created_at) values($1,$2,$3,'analyzing',$4)",[id(120),id(1),e.thread,offset(e.at,16)]);
 assert.equal((await stats()).costs_complete,false,'Unknown AI work cannot disappear from cost');
 await operation('sms-ai:'+id(120),offset(e.at,16),{cents:3});s=await stats();assert.deepEqual([s.cost_cents,s.costs_complete],[7,true]);
 await q("insert into icash_call_recordings(id,account_id,operation_key,screening_id,party,to_phone,created_at) values($1,$2,'fixture-unknown-call',$3,'seller','+12125550100',$4)",[id(121),id(1),id(100),offset(e.at,20)]);
 assert.equal((await stats()).costs_complete,false,'A call with no carrier ID still has uncertain cost');
 await operation('fixture-unknown-call',offset(e.at,20),{cents:5,state:'dispatched'});assert.equal((await stats()).costs_complete,false);
 await q("update icash_operation_spend set state='settled',cost_basis='estimated' where operation_key='fixture-unknown-call'");assert.equal((await stats()).costs_complete,false,'Estimated settlement is not verified provider cost');
 await q("update icash_operation_spend set cost_basis='verified' where operation_key='fixture-unknown-call'");s=await stats();assert.deepEqual([s.cost_cents,s.costs_complete],[12,true]);
 for(const field of ['actual_micros','charged_cents','settled_at','settlement_evidence']){
  await db.exec('begin');await q(`update icash_operation_spend set ${field}=null where operation_key='fixture-unknown-call'`);
  assert.equal((await stats()).costs_complete,false,`Missing original ${field} remains unknown`);await db.exec('rollback');
 }
 await q("insert into icash_call_recordings(id,account_id,operation_key,screening_id,party,to_phone,created_at) select $1,account_id,operation_key,screening_id,party,to_phone,created_at from icash_call_recordings where id=$2",[id(122),id(121)]);
 assert.equal((await stats()).cost_cents,12,'Duplicate projections cannot duplicate one operation cost');
 await q("insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,conversation_id,state,result,created_at,completed_at) values($1,$2,$3,'seller','fixture-unknown-call','fixture-call','complete','{\"interested\":true,\"transcript\":[{\"role\":\"agent\",\"message\":\"Are you the owner?\"},{\"role\":\"user\",\"message\":\"Yes\"}]}',$4,$5)",[id(123),id(1),id(100),offset(e.at,20),offset(e.at,21)]);
 await q("update icash_text_messages set body='Maybe' where id=$1",[id(106)]);assert.equal((await stats()).positive,0,'A later call provider flag cannot manufacture SMS selling interest');
 await q("update icash_text_messages set body='Yes' where id=$1",[id(106)]);
 await q("update icash_live_conversations set result='{\"transcript\":[{\"role\":\"user\",\"message\":\"Stop calling me\"}]}' where id=$1",[id(123)]);s=await stats();assert.deepEqual([s.positive,s.opted_out],[0,1]);
 await q("update icash_call_recordings set to_phone='+12125550999'");s=await stats();assert.deepEqual([s.positive,s.opted_out,s.cost_cents],[1,0,12],'Other recipient calls do not label this reply, but all property contact costs remain counted');
 await q("update icash_call_recordings set to_phone='+12125550100'");await q('delete from icash_live_conversations where id=$1',[id(123)]);

 // Exact source binding and dispatch clock protect the prospective denominator.
 for(const [sql,args] of [
  ['update icash_text_messages set body=$2 where id=$1',[e.message,'Changed body']],
  ['update icash_text_messages set state=$2 where id=$1',[e.message,'accepted']],
  ['update icash_text_messages set provider_id=$2 where id=$1',[e.message,'']],
  ['update icash_text_messages set last_delivery_at=$2 where id=$1',[e.message,stamp(-1)]],
  ['update icash_operation_spend set account_id=$2 where operation_key=$1',['text:'+e.message,id(2)]],
  ['update icash_operation_spend set dispatched_at=$2 where operation_key=$1',['text:'+e.message,offset(e.at,-3)]],
  ['update icash_seller_opener_assignments set learning_policy_version=$2 where thread_id=$1',[e.thread,'legacy']],
 ]){
  await db.exec('begin');await q(sql,args);assert.equal(await stats(),undefined,'Mismatched source cannot enter the v5 cohort');await db.exec('rollback');
 }
 await q('update icash_text_messages set created_at=$2,last_delivery_at=$3 where id=$1',[e.message,stamp(100),stamp(0.05)]);
 assert.equal((await stats()).contract_trials,0,'Queue age and delayed receipt do not mature dispatch-based outcomes');
 const old=await exposure(200,73);await incoming(old,204,73*60-10,'Yes');assert.equal((await stats()).positive,1,'An unbound late YES does not improve the experiment');
 await q(`insert into icash_text_messages(id,thread_id,account_id,direction,state,body,provider_id,created_at,last_delivery_at)
  values($1,$2,$3,'outgoing','delivered','Would you be interested in selling your property for all cash?','fixture-old-question',$4,$5)`,[id(205),old.thread,id(1),offset(old.at,10),offset(old.at,12)]);
 await q('update icash_sms_seller_openings set interest_message_id=$1 where thread_id=$2',[id(205),old.thread]);await operation('text:'+id(205),offset(old.at,11));
 assert.equal((await stats()).positive,1,'Selling interest after 72 hours is outside the fixed comparison');
 await q("insert into icash_call_recordings(id,account_id,operation_key,screening_id,party,to_phone,created_at) values($1,$2,'fixture-later-call',$3,'seller','+12125550100',$4)",[id(220),id(1),id(200),offset(old.at,72*60+30)]);
 s=await stats();assert.equal(s.costs_complete,true,'Work after the fixed contact window is not misattributed to its cost');
 const repeat=await exposure(1000,73-5/60,'identity_timing_v5');
 await q("update icash_screening_jobs set snapshot='{\"propertyId\":\"fixture-100\"}' where id=$1",[id(1000)]);
 assert.equal(await stats('identity_timing_v5'),undefined,'A later variant on a re-screened property cannot add another trial');
 s=await stats();assert.deepEqual([s.attempts,s.positive,s.cost_cents],[2,1,18],'First property exposure owns outcomes and every incurred property contact cost');
 const tied=await exposure(1100,73,'identity_as_is_v5');await q("update icash_screening_jobs set snapshot='{\"propertyId\":\"fixture-100\"}' where id=$1",[id(1100)]);
 assert.equal(await stats('identity_as_is_v5'),undefined,'Equal dispatch clocks use a deterministic assignment/thread tie-break across variants');
 const protectedRows=await val(`select jsonb_build_object('assignments',(select jsonb_agg(to_jsonb(a) order by thread_id) from icash_seller_opener_assignments a),
  'messages',(select jsonb_agg(to_jsonb(m) order by id) from icash_text_messages m),'operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o))`);
 await q("insert into icash_learning_rollups(account_id,domain,context,market,variant,attempts,positive) values($1,'seller_sms','identity-v4','*','legacy',7,2)",[id(1)]);
 await val('select icash_refresh_seller_interest($1)',[id(1)]);
 assert.equal(await val("select attempts from icash_learning_rollups where context='identity-v4'"),7,'Existing legacy context rows are untouched');
 assert.deepEqual(await val(`select jsonb_build_object('assignments',(select jsonb_agg(to_jsonb(a) order by thread_id) from icash_seller_opener_assignments a),
  'messages',(select jsonb_agg(to_jsonb(m) order by id) from icash_text_messages m),'operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o))`),protectedRows,'Refresh never rewrites source evidence');

 // Test/demo, owner, and inbound data never enters the new shared cohort.
 const excluded=[];
 excluded.push(await exposure(300,1,'identity_timing_v5',3));
 excluded.push(await exposure(400,1,'identity_timing_v5',4));
 await q("insert into icash_funding_orders(account_id,mode,state) values($1,'test','paid')",[id(4)]);
 const practice=await exposure(500,1,'identity_timing_v5');excluded.push(practice);await q("update icash_screening_jobs set snapshot='{\"practice\":true}' where id=$1",[id(500)]);
 const intake=await exposure(600,1,'identity_timing_v5');excluded.push(intake);await q('update icash_text_threads set seller_intake_id=$2 where id=$1',[intake.thread,id(999)]);
 const inbound=await exposure(700,1,'identity_timing_v5');excluded.push(inbound);await q("update icash_screening_jobs set event_key='seller:form' where id=$1",[id(700)]);
 for(const x of excluded)await val('select icash_refresh_seller_interest_v5($1)',[id(x.account)]);
 assert.equal(await val("select count(*) from icash_learning_rollups where context='identity-v5' and variant='identity_timing_v5'"),0);

 const young=await exposure(900,1,'identity_cash_v5',2);await incoming(young,904,5);
 await q(`insert into icash_text_messages(id,thread_id,account_id,direction,state,body,provider_id,created_at,last_delivery_at)
  values($1,$2,$3,'outgoing','delivered','Would you be interested in selling your property for all cash?','fixture-young-question',$4,$5)`,[id(905),young.thread,id(2),offset(young.at,10),offset(young.at,12)]);
 await q('update icash_sms_seller_openings set owner_reply_id=$1,interest_message_id=$2 where thread_id=$3',[id(904),id(905),young.thread]);
 await operation('text:'+id(905),offset(young.at,11),{account:2});await incoming(young,906,15);
 assert(await val('select icash_seller_sms_interest_v5_at($1,$2,$3,now())',[id(2),young.thread,young.at]),'Early interest remains verifiable source evidence');
 await val('select icash_refresh_seller_interest_v5($1)',[id(2)]);
 assert.deepEqual((await q("select pending,positive from icash_learning_rollups where account_id=$1 and context='identity-v5'",[id(2)])).rows[0],{pending:1,positive:0},'Every experiment completes72hours before a positive reward, even after early Yes');
 await incoming(young,907,20,'STOP');await val('select icash_refresh_seller_interest_v5($1)',[id(2)]);
 assert.deepEqual((await q("select pending,positive,opted_out from icash_learning_rollups where account_id=$1 and context='identity-v5'",[id(2)])).rows[0],{pending:1,positive:0,opted_out:1},'Early opt-out reaches the safety gate without premature reward');

 const prior=await exposure(1300,1,'identity_timing_v5');
 await q(`insert into icash_text_messages(id,thread_id,account_id,direction,state,body,provider_id,created_at)
  values($1,$2,$3,'outgoing','accepted','Legacy outreach','fixture-prior',$4)`,[id(1304),prior.thread,id(1),offset(prior.at,-1440)]);
 assert.equal(await stats('identity_timing_v5'),undefined,'Known earlier outreach cannot become a new treatment merely by changing the copy version');
 const earlierCall=await exposure(1400,1,'identity_timing_v5');
 await q("insert into icash_call_recordings(id,account_id,operation_key,screening_id,party,dial_claimed_at,created_at) values($1,$2,'prior-unknown-call',$3,'seller',$4,$4)",[id(1404),id(1),id(1400),offset(earlierCall.at,-60)]);
 assert.equal(await stats('identity_timing_v5'),undefined,'An earlier uncertain dial is not a fresh property treatment');

 // Contract/closing labels use the existing verified envelope/title reader.
 const mature=await exposure(800,61*24,'identity_as_is_v5');
 await q("update icash_deal_files set stage='closed',seller_signed_at=$2,funded_at=$2 where id=$1",[id(801),offset(mature.at,1440)]);
 s=await stats('identity_as_is_v5');assert.deepEqual([s.contract_trials,s.contracts,s.closing_trials,s.closings],[1,0,1,0],'Optimistic stage/timestamps are not conversion evidence');
 const signature=async(n,kind,days)=>{
  const recipients=[{id:'seller',email:'seller@example.invalid'},{id:'principal',email:'principal@example.invalid'}],provider='fixture-envelope-'+n,hash='fixture-terms-'+n;
  const evidence={id:provider,test_mode:false,status:'completed',apply_signing_order:true,metadata:{icash_envelope:id(n),terms_hash:hash},recipients:recipients.map((r,i)=>({...r,status:'signed',signing_order:i+1}))};
  await q(`insert into icash_signing_envelopes(id,account_id,deal_id,kind,test_mode,state,provider_id,terms_hash,recipients,provider_evidence,updated_at)
   values($1,$2,$3,$4,false,'completed',$5,$6,$7,$8,$9)`,[id(n),id(1),id(801),kind,provider,hash,recipients,evidence,offset(mature.at,days*1440)]);
 };
 await signature(850,'purchase',1);await signature(851,'assignment',2);
 await q("insert into icash_title_replies(id,account_id,deal_id,sender_verified,received_at) values($1,$2,$3,true,$4)",[id(852),id(1),id(801),offset(mature.at,3*1440)]);
 await q("insert into icash_closing_updates(id,account_id,deal_id,reply_id,kind,effective_date,created_at,confirmation_source) values($1,$2,$3,$4,'closed',$5,$6,'verified_title_format')",[id(853),id(1),id(801),id(852),offset(mature.at,3*1440).slice(0,10),offset(mature.at,3*1440)]);
 s=await stats('identity_as_is_v5');assert.deepEqual([s.contracts,s.closings],[1,1]);
 const repeatedDeal=await exposure(1200,61*24-1,'identity_timing_v5');await q("update icash_screening_jobs set snapshot='{\"propertyId\":\"fixture-800\"}' where id=$1",[id(1200)]);
 assert.equal(await stats('identity_timing_v5'),undefined,'Later property threads cannot duplicate contract or closing trials');
 await q('update icash_signing_envelopes set deal_id=$1 where id in ($2,$3)',[id(1201),id(850),id(851)]);
 await q('update icash_title_replies set deal_id=$1 where id=$2',[id(1201),id(852)]);await q('update icash_closing_updates set deal_id=$1 where id=$2',[id(1201),id(853)]);
 s=await stats('identity_as_is_v5');assert.deepEqual([s.contract_trials,s.contracts,s.closing_trials,s.closings],[1,1,1,1],'Verified outcome on a later same-property deal still belongs once to its first exposure');
 await q('update icash_signing_envelopes set test_mode=true where id=$1',[id(850)]);s=await stats('identity_as_is_v5');assert.deepEqual([s.contracts,s.closings],[0,0],'Practice signatures do not convert');
 await q('update icash_signing_envelopes set test_mode=false where id=$1',[id(850)]);
 await q('update icash_title_replies set sender_verified=false where id=$1',[id(852)]);assert.equal((await stats('identity_as_is_v5')).closings,0,'Unverified title receipt does not close');
 console.log('SMS v5 outcomes: prospective delivered/dispatch binding, selling-question rewards, refusal/opt-out handling, complete incurred SMS/AI/unknown-call cost, owner/test/inbound exclusion, verified conversions, private ACL and immutable source/legacy evidence passed.');
}finally{await db.close();}
