// Real recovery migration and triggers in an isolated database. Provider dispatch,
// consent/financial delegates are explicit fixtures; no external calls occur.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
globalThis.fetch=async()=>{throw Error('NO_NETWORK_IN_RECOVERY_TEST');};
const q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
const rpc=async(name,args=[])=>(await one(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args)).v;
const a=randomUUID(),other=randomUUID(),owner=randomUUID(),deal=randomUUID(),screen=randomUUID(),thread=randomUUID();
let checks=0;
async function test(name,fn){await q('begin');try{await fn();checks++;console.log('PASS '+name);}finally{await q('rollback');}}
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create schema icash_seller_agreement_private;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
 create table icash_screening_jobs(id uuid primary key,account_id uuid);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb default '{}');
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,recipient text,retired_at timestamptz,paused boolean default false,manual_only boolean default false,ai_mode text default 'auto',timezone text default 'UTC');
 create table icash_text_messages(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,direction text,body text,state text,provider_id text,last_delivery_at timestamptz,created_at timestamptz default now());
 create table icash_text_ai_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,message_id uuid,state text,analysis jsonb,outgoing_id uuid);
 create table icash_live_conversations(id uuid primary key,account_id uuid,screening_id uuid,contact_key text,party text,state text,operation_key text,result jsonb,completed_at timestamptz);
 create table icash_seller_agreement_private.call_history(session_id uuid primary key,account_id uuid,screening_id uuid,contact_key text,transcript jsonb,completed_at timestamptz);
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean,provider_id text);
 create table icash_closing_updates(id uuid primary key,account_id uuid,deal_id uuid,kind text,confirmed_by uuid,confirmation_source text,created_at timestamptz default now());
 create table icash_live_callbacks(account_id uuid,screening_id uuid,state text);
 create table icash_text_suppressions(phone text primary key,reason text);create table icash_contact_suppressions(contact_key text);
 create table icash_operating_budget(id integer primary key,enabled boolean);insert into icash_operating_budget values(1,true);
 create table icash_wallets(account_id uuid,balance_cents integer,reserved_cents integer);
 create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid,kind text constraint icash_automation_tickets_kind_check check(kind in ('seller_opener')),opener_message_id uuid,token text default gen_random_uuid()::text,created_at timestamptz default now());
 create table fixture_guard(allowed boolean default true,claims integer default 0);insert into fixture_guard default values;
 create table fixture_scope(value jsonb);
 create table fixture_slots(slots jsonb default '[]');insert into fixture_slots default values;
 create table icash_buyer_viewing_requests(id uuid primary key,account_id uuid,deal_id uuid,thread_id uuid,source_id uuid,kind text,state text,quote text default 'What viewing times are available?',viewing_quote text,created_at timestamptz default now());
 create function icash_seller_conversation_context(uuid,uuid) returns jsonb language sql as $$select case when allowed then '{}'::jsonb end from public.fixture_guard$$;
 create function icash_seller_conversation_human(text) returns boolean language sql as $$select coalesce($1 ~* 'talk to a human|real person',false)$$;
 create function icash_seller_agreement_call_context(text,text) returns jsonb language sql as $$select value from public.fixture_scope$$;
 create function icash_current_viewing_slots(uuid,uuid) returns jsonb language sql as $$select slots from public.fixture_slots$$;
 create function icash_seller_sms_permission_current(uuid,uuid,boolean) returns boolean language sql as $$select allowed from public.fixture_guard$$;
 create function icash_seller_viewing_context(uuid,uuid) returns jsonb language sql as $$select case when allowed then '{}'::jsonb end from public.fixture_guard$$;
 create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select allowed from public.fixture_guard$$;
 create function icash_buyer_package_data(uuid,uuid) returns jsonb language sql as $$select '{"reserved":false}'::jsonb$$;
 create function icash_queue_text(a uuid,t uuid,k uuid,b text,assets uuid[]) returns uuid language plpgsql as $$declare m uuid;begin
  insert into public.icash_text_messages(account_id,thread_id,direction,body,state) values(a,t,'outgoing',b,'ready') returning id into m;return m;end$$;
 create function icash_claim_text(uuid,uuid,text) returns jsonb language plpgsql as $$begin update public.fixture_guard set claims=claims+1;return '{"fixture":"existing dispatch gate"}'::jsonb;end$$;
 create function icash_next_automation() returns jsonb language sql as $$select '{}'::jsonb$$;
 grant usage on schema public to service_role;grant select on all tables in schema public to service_role;
 `);
 await pg.exec(readFileSync('supabase/migrations/20261009221637_seller_gap_recovery_learning.sql','utf8'));
 await q('insert into auth.users values($1)',[owner]);
 await q('insert into icash_accounts(id,owner_user_id) values($1,$3),($2,$3)',[a,other,owner]);
 await q('insert into icash_screening_jobs values($1,$2)',[screen,a]);
 await q("insert into icash_deal_files(id,account_id,screening_id,stage) values($1,$2,$3,'draft')",[deal,a,screen]);
 await q("insert into icash_text_threads(id,account_id,deal_id,party,recipient) values($1,$2,$3,'seller','+12145550199')",[thread,a,deal]);
 await q('insert into icash_wallets values($1,100,0)',[a]);
 const turn=(role,message)=>({role,message});
 const open=async(reason='unanswered',source='text_ai')=>{
  const mid=randomUUID(),job=randomUUID();
  await q("insert into icash_text_messages(id,account_id,thread_id,direction,body,state,created_at) values($1,$2,$3,'incoming','Could you explain that?','received',now()-interval '10 minutes')",[mid,a,thread]);
  await q("insert into icash_text_ai_jobs(id,account_id,thread_id,message_id,state,analysis) values($1,$2,$3,$4,'analyzing','{}')",[job,a,thread,mid]);
  const id=await rpc('icash_open_seller_gap',[a,thread,source,job,reason,'Could you explain that?',new Date(Date.now()-600000).toISOString()]);
  await q("update icash_text_ai_jobs set state='drafted',analysis='{\"action\":\"review\"}' where id=$1",[job]);
  return {id,job,mid};
 };
 const prepare=async g=>rpc('icash_prepare_seller_recovery',[a,g]);
 const claim=async m=>rpc('icash_claim_text',[a,m,'fixture']);
 for(const [body,expected] of [['Please stop.',true],['Stop please.',true],['Leave me alone.',true],['STOP, call me tomorrow.',true],['Dont text me.',true],['Please stop by tomorrow.',false],['My bus stop is nearby.',false],['Call me tomorrow.',false]])await test('contact intent: '+body,async()=>assert.equal(await rpc('icash_seller_contact_stop',[body]),expected));
 for(const [body,reason] of [['I need my spouse to agree first.','owners'],['No, there is a lien.','material_facts'],['Not now, call me tomorrow.','callback'],['Wait, I need to think.','declined'],['I want to talk to a human.','human'],['Please stop.','contact_stop']])await test('gap classification: '+reason,async()=>assert.equal(await rpc('icash_seller_gap_reason',[[turn('user',body)],true]),reason));
 await test('AI review creates a durable case, queue is idempotent, final claim delegates',async()=>{
  const {id,job}=await open();assert(id);assert.equal((await one('select count(*)::int n from icash_seller_gaps')).n,1);
  const m=await prepare(id);assert(m);assert.equal(await prepare(id),null);assert(await claim(m));
  assert.equal((await one('select claims from fixture_guard')).claims,1);
  await q("update icash_text_ai_jobs set state='queued',outgoing_id=$2 where id=$1",[job,randomUUID()]);assert.equal(await claim(m),null,'normal reply invalidates the recovery');
 });
 await test('no automatic repeat after claimed/delivered follow-up',async()=>{
  const {id}=await open(),m=await prepare(id);
  await q("update icash_text_messages set state='delivered',provider_id='fixture',last_delivery_at=now() where id=$1",[m]);
  assert.equal((await one('select state from icash_seller_gaps where id=$1',[id])).state,'waiting');
  assert.equal((await one('select count(*)::int n from icash_seller_gaps')).n,1,'a recovery does not start another reminder');
  assert.equal(await prepare(id),null);
 });
 await test('new seller reply stops old queue before send',async()=>{
  const {id}=await open(),m=await prepare(id);await q("insert into icash_text_messages(account_id,thread_id,direction,body,state,created_at) values($1,$2,'incoming','Actually no thanks','received',now()+interval '1 millisecond')",[a,thread]);
  assert.equal(await claim(m),null);assert.equal((await one('select claims from fixture_guard')).claims,0);
 });
 await test('scheduler issues one bounded text ticket, and respects zero balance and quiet hours',async()=>{
  await open();await q("update icash_text_threads set timezone=(select name from pg_timezone_names where extract(hour from now() at time zone name) between 9 and 19 limit 1)");
  await q('update icash_wallets set balance_cents=0');assert.equal((await rpc('icash_next_automation')).token,undefined);
  await q('update icash_wallets set balance_cents=100');await q("update icash_text_threads set timezone=(select name from pg_timezone_names where extract(hour from now() at time zone name)<9 limit 1)");
  assert.equal((await rpc('icash_next_automation')).token,undefined);
  await q("update icash_text_threads set timezone=(select name from pg_timezone_names where extract(hour from now() at time zone name) between 9 and 19 limit 1)");
  assert((await rpc('icash_next_automation')).token);assert.equal((await rpc('icash_next_automation')).token,undefined);
  assert.equal((await one('select kind from icash_automation_tickets')).kind,'seller_recovery');
 });
 for(const mutation of ["update fixture_guard set allowed=false","insert into icash_text_suppressions(phone) values('+12145550199')","update icash_deal_files set stage='under_contract'","update icash_seller_recovery_variants set enabled=false","update icash_text_messages set body='Unapproved promise' where direction='outgoing'"])
  await test('final dispatch holds changed authority: '+mutation,async()=>{const {id}=await open(),m=await prepare(id);await q(mutation);assert.equal(await claim(m),null);assert.equal((await one('select claims from fixture_guard')).claims,0);});
 await test('unknown provider delivery is reviewed and never automatically resent',async()=>{
  const {id}=await open(),m=await prepare(id);await q("update icash_text_messages set state='needs_review' where id=$1",[m]);
  assert.equal(await prepare(id),null);assert.equal((await one("select count(*)::int n from icash_seller_gaps where state='needs_review'")).n,2);
 });
 await test('unanswered clarification escalates after one attempt',async()=>{
  const {id}=await open(),m=await prepare(id);await q("update icash_text_messages set state='delivered',provider_id='fixture' where id=$1",[m]);
  const second=await open();assert.equal((await one('select state from icash_seller_gaps where id=$1',[second.id])).state,'needs_review');assert.equal(await prepare(second.id),null);
 });
 await test('no-response cadence waits 24 hours and respects scheduled calls',async()=>{
  const {id}=await open('no_response','call');assert.equal(await prepare(id),null);
  await q("update icash_seller_gaps set due_at=now() where id=$1",[id]);await q('delete from icash_text_messages');await q('delete from icash_text_ai_jobs');
  await q("insert into icash_live_callbacks values($1,$2,'pending_dispatch_review')",[a,screen]);assert.equal(await prepare(id),null);
 });
 await test('cross-tenant, retired, buyer and practice scopes cannot create seller cases',async()=>{
  const params=[a,thread,'tool',randomUUID(),'owners','Other owner',new Date().toISOString()];assert.equal(await rpc('icash_open_seller_gap',[other,...params.slice(1)]),null);
  for(const mutation of ["update icash_text_threads set party='buyer'","update icash_text_threads set party='seller',retired_at=now()","update icash_text_threads set retired_at=null;update icash_deal_files set terms='{\"practice\":true}'"]){await pg.exec(mutation);assert.equal(await rpc('icash_open_seller_gap',params),null);}
 });
 await test('all-owners tool failure survives call with exact binding',async()=>{
  assert.equal(await rpc('icash_record_seller_tool_gap',['hash','conv_fixture','all_owners_required']),null);
  await q('insert into fixture_scope values($1)',[{accountId:a,dealId:deal,phone:'+12145550199'}]);assert(await rpc('icash_record_seller_tool_gap',['hash','conv_fixture','all_owners_required']));
  assert.equal((await one('select reason,state from icash_seller_gaps')).reason,'owners');
 });
 await test('completed voice and inbound histories capture unresolved questions once',async()=>{
  const result={transcript:[turn('user','How do you handle that?'),turn('agent','I need to check.')],optedOut:false};
  const key=(await one("select encode(sha256(convert_to('+12145550199','UTF8')),'hex') v")).v;
  await q("insert into icash_live_conversations values($1,$2,$3,$4,'seller','complete','voice:fixture',$5,now())",[randomUUID(),a,screen,key,result]);
  await q("update icash_live_conversations set state='complete'");assert.equal((await one('select count(*)::int n from icash_seller_gaps')).n,1);
  await q('insert into icash_seller_agreement_private.call_history values($1,$2,$3,$4,$5,now())',[randomUUID(),a,screen,key,result.transcript]);assert.equal((await one('select count(*)::int n from icash_seller_gaps')).n,2);
 });
 await test('only verified live purchase signatures and title confirmations count',async()=>{
  const {id}=await open(),m=await prepare(id);await q("update icash_text_messages set state='delivered',provider_id='fixture',last_delivery_at=now() where id=$1",[m]);
  for(const [kind,state,mode,provider] of [['purchase','awaiting_counterparty',false,'p'],['purchase','completed',true,'p'],['assignment','completed',false,'p'],['purchase','completed',false,null]])await q('insert into icash_signing_envelopes values($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),a,deal,kind,state,mode,provider]);
  assert.equal((await one('select contract_at from icash_seller_recovery_attempts')).contract_at,null);
  await q("insert into icash_signing_envelopes values($1,$2,$3,'purchase','completed',false,'verified')",[randomUUID(),a,deal]);assert((await one('select contract_at from icash_seller_recovery_attempts')).contract_at);
  await q("insert into icash_closing_updates(id,account_id,deal_id,kind,confirmed_by,confirmation_source) values($1,$2,$3,'closed',$4,'user_review')",[randomUUID(),a,deal,owner]);assert((await one('select closed_at from icash_seller_recovery_attempts')).closed_at);
 });
 await test('owner review needs exact version and explanation; no tenant reassignment',async()=>{
  const {id}=await open('owners');const {updated_at}=await one('select updated_at from icash_seller_gaps where id=$1',[id]);
  assert.equal(await rpc('icash_review_seller_gap',[other,owner,id,updated_at,'Confirmed both owners will participate.']),false);
  assert.equal(await rpc('icash_review_seller_gap',[a,randomUUID(),id,updated_at,'Confirmed both owners will participate.']),false);
  assert.equal(await rpc('icash_review_seller_gap',[a,owner,id,updated_at,'done']),false);
  assert.equal(await rpc('icash_review_seller_gap',[a,owner,id,updated_at,'Confirmed both owners will participate.']),true);
 });
 await test('sparse cohorts remain balanced and no cross-channel/tenant promotion',async()=>{
  assert.equal(await rpc('icash_choose_seller_recovery',[a,'unanswered','draft','text',9000]),'unanswered-v1');
  assert.equal(await rpc('icash_choose_seller_recovery',[a,'unanswered','draft','text',9001]),'unanswered-v2');
  assert.equal(await rpc('icash_choose_seller_recovery',[other,'unanswered','draft','call',9001]),'unanswered-v2');
  await assert.rejects(rpc('icash_choose_seller_recovery',[a,'unanswered','draft','text',10000]),/Invalid recovery bucket/);
 });
 await test('mature verified contracts shift allocation; opt-out harm removes a variant',async()=>{
  // Unique opportunities, not 200 events from the same seller.
  for(let i=0;i<200;i++){
   const did=randomUUID(),gid=randomUUID(),mid=randomUUID(),arm=i<100?'unanswered-v1':'unanswered-v2';
   await q("insert into icash_deal_files(id,account_id,screening_id,stage) values($1,$2,$3,'draft')",[did,a,screen]);
   await q("insert into icash_text_messages(id,account_id,thread_id,direction,body,state) values($1,$2,$3,'outgoing','Fixture','accepted')",[mid,a,thread]);
   await q("insert into icash_seller_gaps(id,account_id,deal_id,screening_id,thread_id,source,source_id,reason,stage,channel,quote,state,due_at,expires_at,source_at) values($1,$2,$3,$4,$5,'text_ai',$1,'unanswered','draft','text','Fixture','resolved',now(),now(),now())",[gid,a,did,screen,thread]);
   await q("insert into icash_seller_recovery_attempts(gap_id,account_id,deal_id,thread_id,variant,reason,stage,source_channel,message_id,assigned_at,delivered_at,contract_at) values($1,$2,$3,$4,$5,'unanswered','draft','text',$6,now()-interval '40 days',now()-interval '40 days',case when $7 then now()-interval '20 days' end)",[gid,a,did,thread,arm,mid,i<10||(i>=100&&i<130)]);
  }
  assert.equal(await rpc('icash_choose_seller_recovery',[a,'unanswered','draft','text',9000]),'unanswered-v2');
  assert.equal(await rpc('icash_choose_seller_recovery',[a,'unanswered','draft','text',4000]),'unanswered-v1','baseline exploration persists');
  assert.equal(await rpc('icash_choose_seller_recovery',[other,'unanswered','draft','text',9000]),'unanswered-v1');
  assert.equal(await rpc('icash_choose_seller_recovery',[a,'unanswered','draft','call',9000]),'unanswered-v1');
  await q("update icash_seller_recovery_attempts set opted_out_at=now() where variant='unanswered-v2'");
  assert.equal(await rpc('icash_choose_seller_recovery',[a,'unanswered','draft','text',9001]),'unanswered-v1','harmful winner rolls back automatically');
 });
 await test('buyer viewing request asks seller once, relays dated slots, and never books a visit',async()=>{
  const buyer=randomUUID(),request=randomUUID();
  await q("update icash_deal_files set stage='under_contract'");
  await q("insert into icash_text_threads(id,account_id,deal_id,party,recipient) values($1,$2,$3,'buyer','+12145550200')",[buyer,a,deal]);
  await q("insert into icash_buyer_viewing_requests(id,account_id,deal_id,thread_id,source_id,kind,state) values($1,$2,$3,$4,$5,'viewing','needs_confirmation')",[request,a,deal,buyer,randomUUID()]);
  const followup=await one('select * from icash_seller_viewing_followups where request_id=$1',[request]);assert(followup.gap_id);
  await q("update icash_seller_gaps set due_at=now() where id=$1",[followup.gap_id]);const sellerMessage=await prepare(followup.gap_id);assert(sellerMessage);
  assert.match((await one('select body from icash_text_messages where id=$1',[sellerMessage])).body,/viewing|potential buyer/);
  assert.equal(await rpc('icash_prepare_viewing_relay',[request]),null,'no fabricated slots');
  const tomorrow=new Date(Date.now()+86400000);tomorrow.setUTCHours(19,0,0,0);
  await q('update fixture_slots set slots=$1',[[{startsAt:tomorrow.toISOString(),endsAt:new Date(tomorrow.getTime()+3600000).toISOString(),timezone:'America/Chicago'}]]);
  const buyerMessage=await rpc('icash_prepare_viewing_relay',[request]);assert(buyerMessage);assert.equal(await rpc('icash_prepare_viewing_relay',[request]),null);
  const message=await one('select * from icash_text_messages where id=$1',[buyerMessage]);assert.equal(message.thread_id,buyer);assert.match(message.body,/PM/);assert.match(message.body,/still needs confirmation/);assert(await claim(buyerMessage));
  assert.equal((await one('select state from icash_buyer_viewing_requests where id=$1',[request])).state,'needs_confirmation');
  await q("update fixture_slots set slots='[]'");assert.equal(await claim(buyerMessage),null,'withdrawn seller slot blocks stale buyer delivery');
 });
 for(const kind of ['reservation','payment_reported'])await test('combined buyer '+kind+' and viewing request retains seller follow-up on update',async()=>{
  const buyer=randomUUID(),request=randomUUID();
  await q("update icash_deal_files set stage='under_contract'");
  await q("insert into icash_text_threads(id,account_id,deal_id,party,recipient) values($1,$2,$3,'buyer','+12145550200')",[buyer,a,deal]);
  await q("insert into icash_buyer_viewing_requests(id,account_id,deal_id,thread_id,source_id,kind,state,quote) values($1,$2,$3,$4,$5,$6,'needs_confirmation','Send the agreement')",[request,a,deal,buyer,randomUUID(),kind]);
  assert.equal((await one('select count(*)::int n from icash_seller_viewing_followups')).n,0,'agreement alone does not request a visit');
  await q("update icash_buyer_viewing_requests set viewing_quote='I also want to see the property' where id=$1",[request]);
  const saved=await one('select * from icash_seller_viewing_followups where request_id=$1',[request]);assert(saved.gap_id);assert.equal(saved.request_quote,'I also want to see the property');
  await q("update icash_buyer_viewing_requests set viewing_quote='Which viewing dates are available?' where id=$1",[request]);
  assert.equal((await one('select count(*)::int n from icash_seller_gaps')).n,1,'updated request reuses seller ask');
  assert.equal((await one('select request_quote from icash_seller_viewing_followups where request_id=$1',[request])).request_quote,'Which viewing dates are available?');
  await q('update fixture_slots set slots=$1',[[{startsAt:new Date(Date.now()+86400000).toISOString(),timezone:'America/Chicago'}]]);
  const message=await rpc('icash_prepare_viewing_relay',[request]);assert(message);assert(await claim(message));
  await q('update icash_buyer_viewing_requests set viewing_quote=null where id=$1',[request]);
  assert.equal(await claim(message),null,'withdrawn viewing part prevents stale delivery while retaining purchase request');
  assert.equal((await one('select kind from icash_buyer_viewing_requests where id=$1',[request])).kind,kind);
 });
 await test('verified inbound opt-out suppresses phone and invalidates queued recovery',async()=>{
  const {id}=await open(),m=await prepare(id);const key=(await one("select encode(sha256(convert_to('+12145550199','UTF8')),'hex') v")).v;
  await q('insert into icash_seller_agreement_private.call_history values($1,$2,$3,$4,$5,now())',[randomUUID(),a,screen,key,[turn('user','Please stop.')]]);
  assert.equal((await one('select phone from icash_text_suppressions')).phone,'+12145550199');assert.equal(await claim(m),null);
 });
 // The preceding expected error aborts its rollback-only scenario, never the fixture.
 await test('private tables and functions deny anonymous and authenticated roles',async()=>{
  for(const role of ['anon','authenticated'])for(const table of ['icash_seller_gaps','icash_seller_recovery_attempts','icash_seller_recovery_variants']){
   assert.equal((await one('select has_table_privilege($1,$2,\'SELECT\') v',[role,table])).v,false);
  }
  assert.equal((await one("select has_function_privilege('anon','icash_prepare_seller_recovery(uuid,uuid)','EXECUTE') v")).v,false);
  assert.equal((await one("select has_function_privilege('service_role','icash_prepare_seller_recovery(uuid,uuid)','EXECUTE') v")).v,true);
 });
 console.log(JSON.stringify({checks,passed:checks,network:'disabled',scope:'real recovery SQL, isolated delegate fixtures'}));
}catch(error){console.error(JSON.stringify({error:error.message,code:error.code,where:error.where,detail:error.detail}));process.exitCode=1;}finally{await pg.close();}
