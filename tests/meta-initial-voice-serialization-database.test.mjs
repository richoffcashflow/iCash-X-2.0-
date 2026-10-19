// LOCAL SIMULATION ONLY. Synthetic records, no credentials, providers or production data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create();
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scalar=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0])[0];
const prepare=lead=>scalar('select icash_meta_prepare_voice($1)',[lead]);
const generic=()=>scalar('select icash_next_before_fulfillment()');
const row=async(table,key,value)=>(await pg.query(`select * from ${table} where ${key}=$1`,[value])).rows[0];
function definition(file,name){
 const found=read('config/'+file+'.sql').match(new RegExp(`create(?: or replace)? function public\\.${name}\\([^]*?\\$\\$;`,'i'));
 assert(found,`SQL definition exists: ${name}`);return found[0];
}
const first={account:id(1),lead:id(2),screen:id(3),deal:id(4),job:id(5),permission:id(6),source:id(7),phone:'+12025550123'};
const second={account:id(1),lead:id(12),screen:id(13),deal:id(14),job:id(15),permission:id(16),source:id(7),phone:'+12025550124'};
const other={account:id(21),lead:id(22),screen:id(23),deal:id(24),job:id(25),permission:id(26),source:id(27),phone:'+12025550125'};
async function scenario(label,fn){
 await pg.exec('begin');
 try{await fn();}catch(error){throw new Error(label+': '+error.message,{cause:error});}
 finally{await pg.exec('rollback');}
}
async function unchangedWait(lead=second){
 const before=await row('icash_voice_jobs','id',lead.job);
 const spends=await scalar('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o');
 const count=await scalar('select count(*)::int from icash_voice_jobs');
 assert.equal(await prepare(lead.lead),null);
 assert.deepEqual(await row('icash_voice_jobs','id',lead.job),before,'waiting keeps the original job untouched and ready');
 assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o'),spends,'waiting cannot reserve, cancel or reopen spend');
 assert.equal(await scalar('select count(*)::int from icash_voice_jobs'),count,'waiting cannot create a replacement');
}
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_operating_budget(id int primary key,enabled boolean default true);
 create table icash_accounts(id uuid primary key,bot_paused boolean default false,member boolean default true,voice_enabled boolean default true);
 create table icash_wallets(account_id uuid primary key,balance_cents bigint,reserved_cents bigint default 0);
 create table icash_customer_identities(account_id uuid primary key,principal text);
 create table icash_seller_intakes(id uuid primary key,phone text,name text,address text,state text,assigned_account uuid,screening_id uuid,ai_consented boolean,consent_text text,consent_version text,contact_consent_scope text);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text);
 create table icash_text_suppressions(phone text);
 create table icash_contact_suppressions(contact_key text);
 create table icash_handoffs(account_id uuid,screening_id uuid,state text);
 create table icash_meta_lead_sources(id uuid primary key,account_id uuid,principal text,enabled boolean default true,reviewed_until timestamptz,page_id text,form_id text,consent_text text,consent_version text,timezone text,contact_basis text default 'checkbox',consent_key text);
 create table icash_make_lead_inbox(meta_id text,page_id text,form_id text,is_test boolean default false,state text,payload jsonb);
 create table icash_meta_leads(lead_id uuid primary key,account_id uuid,screening_id uuid,source_id uuid,voice_job_id uuid,paused boolean default false,voice_paused boolean default false,declined_at timestamptz,contact_until timestamptz,submitted_at timestamptz,meta_id text,page_id text,form_id text,consent_text text,consent_version text,timezone text,consent_receipt jsonb,next_attempt_at timestamptz);
 create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,seller_intake_id uuid,phone text,party text default 'seller',revoked_at timestamptz,permission_until timestamptz,dnc_clear boolean default false,dnc_checked_at timestamptz,review_request_id uuid,buyer_id uuid,contact_key text,timezone text,local_start_hour int default 9,local_end_hour int default 20,permission_evidence text);
 create table icash_operational_contacts(id uuid primary key,account_id uuid,contact_key text);
 create view icash_voice_contact_targets as select id,account_id,contact_key from icash_contact_permissions union all select id,account_id,contact_key from icash_operational_contacts;
 create table icash_voice_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,permission_id uuid,state text default 'ready',due_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now(),callback_id uuid,sms_source_message_id uuid,cancellation_notice_id uuid,operational_contact_id uuid,meta_offer_lead_id uuid,meta_retry_of uuid,meta_followup_lead_id uuid,provider_call_sid text,conversation_id text,operation_key text,outcome text);
 create unique index icash_voice_first_once on icash_voice_jobs(permission_id) where callback_id is null and sms_source_message_id is null and cancellation_notice_id is null and meta_offer_lead_id is null and meta_retry_of is null and meta_followup_lead_id is null;
 create table icash_live_conversations(account_id uuid,contact_key text,state text,operation_key text);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,state text default 'reserved',actual_micros bigint,charged_cents bigint,settlement_evidence text,dispatched_at timestamptz);
 create table icash_operation_rates(id uuid primary key,operation text,voice_max_duration_seconds int);
 create table icash_voice_configs(account_id uuid,enabled boolean,reviewed_until timestamptz,seller_rate_id uuid,max_duration_seconds int);
 create table icash_voice_scheduler(id int primary key,last_dispatch_at timestamptz);
 create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),token text default gen_random_uuid()::text,account_id uuid,kind text,voice_job_id uuid);
 create function icash_queue_voice_jobs() returns void language sql as $$select$$;
 create function icash_next_before_voice_dispatch() returns jsonb language sql as $$select null::jsonb$$;
 -- Controlled account inputs; real permission/source binding and scheduler/claim
 -- bodies run below. Existing original permissions require no contact creation.
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select member from public.icash_accounts where id=$1$$;
 create function icash_outreach_voice_current(uuid) returns boolean language sql as $$select voice_enabled from public.icash_accounts where id=$1$$;
 create function icash_prepare_seller_contacts(uuid,uuid,uuid,uuid) returns void language sql as $$select$$;
 create function icash_seller_evidence_before_meta(uuid,uuid,uuid,text) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_claim_operation(text) returns boolean language sql as $$select exists(select 1 from public.icash_operation_spend where operation_key=$1 and state='reserved')$$;
 `);
 await pg.exec(definition('meta-make-intake','icash_meta_contact_receipt_current'));
 let evidence=definition('meta-instant-leads','icash_seller_contact_evidence');
 const binding="or l.consent_version is distinct from m.consent_version or l.consent_text is distinct from m.consent_text";
 assert(evidence.includes(binding));
 evidence=evidence.replace(binding,binding+" or not public.icash_meta_contact_receipt_current(m.source_id,jsonb_build_object('metaId',m.meta_id,'pageId',m.page_id,'formId',m.form_id,'submittedAt',m.consent_receipt->0->>'submittedAt','name',l.name,'phone',l.phone,'consentResponses',m.consent_receipt))");
 await pg.exec(evidence);
 await pg.exec(definition('seller-intake-contacts','icash_seller_voice_permission_current').replaceAll('icash_seller_voice_permission_current','icash_seller_voice_permission_before_meta'));
 await pg.exec(definition('meta-instant-leads','icash_seller_voice_permission_current'));
 await pg.exec(definition('meta-instant-leads','icash_meta_contact_only'));
 await pg.exec(definition('meta-instant-leads','icash_meta_voice_context'));
 await pg.exec(definition('meta-instant-lead-work','icash_meta_prepare_voice'));
 // Execute the repository's existing scheduler patches rather than hand-writing
 // the current selection. No recovery RPC or replacement creation is loaded.
 const firstPatches=read('config/meta-first-call-admission.sql').match(/do \$patch\$[^]*?end \$patch\$;/g);
 await pg.exec(firstPatches.find(sql=>sql.includes("'public.icash_meta_prepare_voice(uuid)'")));
 const followupPatch=read('config/meta-no-response-followups.sql').match(/def:=pg_get_functiondef\('public\.icash_meta_prepare_voice\(uuid\)'[^]*?execute replace\(def,[^]*?;/)[0];
 await pg.exec('do $patch$ declare def text;needle text;begin '+followupPatch+' end $patch$;');
 const oldClaim=definition('meta-instant-leads','icash_meta_claim_voice');
 const hourGate="if (h<9 or h>=20) and not public.icash_meta_call_now(p_account,p_job) and not public.icash_requested_seller_call_current(p_account,p_job) then return false;end if;";
 assert(oldClaim.includes(hourGate));assert(read('config/inbound-contact-anytime.sql').includes(hourGate));
 await pg.exec(oldClaim.replace(hourGate,'-- Current inbound-contact-anytime admission.'));
 await pg.exec(definition('live-dispatch','icash_next_automation').replace('function public.icash_next_automation()', 'function public.icash_next_before_fulfillment()'));
 await pg.exec('revoke all on function icash_next_before_fulfillment() from public,anon,authenticated;grant execute on function icash_next_before_fulfillment() to service_role;');
 await pg.exec('revoke all on function icash_meta_prepare_voice(uuid) from public,anon,authenticated;grant execute on function icash_meta_prepare_voice(uuid) to service_role;');
 await pg.exec(`insert into icash_operating_budget(id) values(1);insert into icash_voice_scheduler(id) values(1);
 insert into icash_operation_rates values('${id(90)}','seller_call',600);
 insert into icash_operation_spend values('voice:SIMULATION-cancelled','${first.account}','${id(90)}','cancelled',0,0,'Voice stopped before provider dispatch: dispatch_permission_changed',null);`);
 for(const a of [first,other])await pg.exec(`
 insert into icash_accounts(id) values('${a.account}');
 insert into icash_wallets(account_id,balance_cents) values('${a.account}',1000);
 insert into icash_customer_identities values('${a.account}','SIMULATION Buyer');
 insert into icash_voice_configs values('${a.account}',true,now()+interval '2 days','${id(90)}',600);
 insert into icash_meta_lead_sources(id,account_id,principal,reviewed_until,page_id,form_id,consent_text,consent_version,timezone,consent_key)
 values('${a.source}','${a.account}','SIMULATION Buyer',now()+interval '2 days','111111','222222','SIMULATION contact consent','fixture-v1','UTC','contact');`);
 for(const a of [first,second,other])await pg.exec(`
 insert into icash_seller_intakes(id,phone,name,state,assigned_account,screening_id,ai_consented,consent_text,consent_version,contact_consent_scope)
 values('${a.lead}','${a.phone}','SIMULATION Seller','awaiting_address','${a.account}','${a.screen}',true,'SIMULATION contact consent','fixture-v1','meta_direct_principal');
 insert into icash_screening_jobs values('${a.screen}','${a.account}','awaiting_address');
 insert into icash_deal_files values('${a.deal}','${a.account}','${a.screen}','draft');
 insert into icash_meta_leads(lead_id,account_id,screening_id,source_id,voice_job_id,contact_until,submitted_at,meta_id,page_id,form_id,consent_text,consent_version,timezone,consent_receipt)
 values('${a.lead}','${a.account}','${a.screen}','${a.source}','${a.job}',now()+interval '2 days',now()-interval '1 hour','${a.lead}','111111','222222','SIMULATION contact consent','fixture-v1','UTC','[{"checkbox_key":"contact","is_checked":true}]');
 insert into icash_contact_permissions(id,account_id,screening_id,seller_intake_id,phone,permission_until,contact_key,timezone,permission_evidence)
 select '${a.permission}','${a.account}','${a.screen}','${a.lead}',l.phone,m.contact_until,encode(sha256(convert_to(l.phone,'UTF8')),'hex'),m.timezone,icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone)->>'evidence'
 from icash_seller_intakes l join icash_meta_leads m on m.lead_id=l.id where l.id='${a.lead}';
 insert into icash_voice_jobs(id,account_id,permission_id) values('${a.job}','${a.account}','${a.permission}');`);
 for(const a of [first,second,other])assert.equal(await scalar('select icash_seller_voice_permission_current($1,$2)',[a.account,a.permission]),true,'real current permission independently validates fixture');
 await scenario('reproduce prior reservation collision',async()=>{
  assert.equal((await prepare(first.lead)).voiceJobId,first.job);
  assert.equal((await prepare(second.lead)).voiceJobId,second.job,'old scheduler issues both initial jobs for one account');
  await pg.exec(`update icash_voice_jobs set state='dispatching' where id='${first.job}';insert into icash_operation_spend(operation_key,account_id,rate_id) values('voice:${second.job}','${second.account}','${id(90)}');`);
  assert.equal(await scalar('select icash_meta_claim_voice($1,$2)',[second.account,second.job]),false,'real final claim blocks second job only after it already reserved');
 });
 await scenario('reproduce generic scheduler bypass',async()=>{
  await pg.exec(`update icash_voice_jobs set state='dispatching' where id='${first.job}';update icash_voice_jobs set due_at=now()-interval '1 hour' where id='${second.job}'`);
  const ticket=await generic();assert(ticket?.token);
  assert.equal(await scalar('select voice_job_id from icash_automation_tickets where token=$1',[ticket.token]),second.job,'old generic issuer steals the waiting Meta initial call');
 });
 const oldGeneric=await scalar("select pg_get_functiondef('icash_next_before_fulfillment()'::regprocedure)");
 const oldDefinition=await scalar("select pg_get_functiondef('icash_meta_prepare_voice(uuid)'::regprocedure)");
 const claimDefinition=await scalar("select pg_get_functiondef('icash_meta_claim_voice(uuid,uuid)'::regprocedure)");
 const sql=read('config/meta-initial-voice-serialization.sql');
 assert.equal(sql,read('supabase/migrations/20261019172259_meta_initial_voice_serialization.sql'));
 await pg.exec(sql);
 const currentDefinition=await scalar("select pg_get_functiondef('icash_meta_prepare_voice(uuid)'::regprocedure)");
 const currentGeneric=await scalar("select pg_get_functiondef('icash_next_before_fulfillment()'::regprocedure)");
 const routeStart=currentGeneric.indexOf('\n and not (v.callback_id');
 const routeEnd=currentGeneric.indexOf('\n order by v.due_at',routeStart);
 assert(routeStart>0&&routeEnd>routeStart);
 assert.equal((currentGeneric.slice(0,routeStart)+currentGeneric.slice(routeEnd)).replace("v.due_at<=now()\n order by", "v.due_at<=now() order by"),oldGeneric,'all other generic queue, scheduler, ticket and fallback behavior is unchanged');
 assert.equal(await scalar("select prosecdef from pg_proc where oid='icash_next_before_fulfillment()'::regprocedure"),false);
 for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_function_privilege($1,'icash_next_before_fulfillment()','execute')",[role]),false);
 const guardStart=currentDefinition.indexOf(' -- Include issued work:');
 const guardEnd=currentDefinition.indexOf(" update public.icash_voice_jobs set state='issued'",guardStart);
 assert(guardStart>0&&guardEnd>guardStart);
 assert.equal(currentDefinition.slice(0,guardStart)+currentDefinition.slice(guardEnd),oldDefinition,'all existing admission, binding, selection and scheduling remain byte-for-byte unchanged');
 assert.equal(await scalar("select pg_get_functiondef('icash_meta_claim_voice(uuid,uuid)'::regprocedure)"),claimDefinition,'final dispatch protections are unchanged');
 assert.equal(await scalar("select prosecdef from pg_proc where oid='icash_meta_prepare_voice(uuid)'::regprocedure"),false);
 for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_function_privilege($1,'icash_meta_prepare_voice(uuid)','execute')",[role]),false);
 assert.equal(await scalar("select has_function_privilege('service_role','icash_meta_prepare_voice(uuid)','execute')"),true);
 await scenario('serialize initial calls before spend',async()=>{
  // PGlite queues a single connection's requests. Exercise both scheduler calls
  // before any claim/reservation; the retained budget FOR UPDATE lock provides
  // the cross-session serialization in PostgreSQL, not this test harness.
  const issued=await Promise.all([prepare(first.lead),prepare(second.lead)]);
  assert.equal(issued.filter(Boolean).length,1);
  assert.equal(issued[0].voiceJobId,first.job);assert.equal(issued[1],null);
  await unchangedWait();assert.equal(await generic(),null,'generic scheduler cannot bypass the waiting Meta queue');assert.equal(await prepare(first.lead),null,'the first call cannot be issued twice');
  assert.equal(await scalar("select count(*)::int from icash_operation_spend where state<>'cancelled'"),0,'a waiting original never reaches reservation');
  await pg.exec(`insert into icash_operation_spend(operation_key,account_id,rate_id) values('voice:${first.job}','${first.account}','${id(90)}');`);
  assert.equal(await scalar('select icash_meta_claim_voice($1,$2)',[first.account,first.job]),true,'first original still passes final admission');
  await unchangedWait();assert.equal(await generic(),null,'generic scheduler cannot issue during active Meta dispatch');
  await pg.exec(`update icash_voice_jobs set state='dispatched',provider_call_sid='SIMULATION completed' where id='${first.job}';insert into icash_live_conversations values('${first.account}','different-contact','waiting','voice:${first.job}');`);
  await unchangedWait();
  await pg.exec("update icash_live_conversations set state='complete'");
  assert.equal((await prepare(second.lead)).voiceJobId,second.job,'second original advances after the first call finishes');
  assert.equal(await scalar('select count(*)::int from icash_voice_jobs where meta_retry_of is not null'),0);
 });
 await scenario('generic routing covers a not-yet-bound initial call',async()=>{
  await pg.exec(`update icash_meta_leads set voice_job_id=null where lead_id='${second.lead}'`);
  assert.equal(await generic(),null);
  assert.equal((await prepare(second.lead)).voiceJobId,second.job);
 });
 await scenario('completed-address initial call retains generic scheduling',async()=>{
  await pg.exec(`update icash_screening_jobs set state='complete' where id='${second.screen}'`);
  const ticket=await generic();assert(ticket?.token);
  assert.equal(await scalar('select voice_job_id from icash_automation_tickets where token=$1',[ticket.token]),second.job);
 });
 for(const purpose of ['callback_id','sms_source_message_id','cancellation_notice_id','operational_contact_id','meta_offer_lead_id','meta_followup_lead_id'])await scenario('generic preserves '+purpose,async()=>{
  await pg.exec(`update icash_voice_jobs set ${purpose}='${id(99)}' where id='${second.job}'`);
  const ticket=await generic();assert(ticket?.token);
  assert.equal(await scalar('select voice_job_id from icash_automation_tickets where token=$1',[ticket.token]),second.job);
 });
 await scenario('generic preserves ordinary voice work before batch limit',async()=>{
  await pg.exec(`insert into icash_voice_jobs(id,account_id,permission_id,due_at) values('${id(89)}','${first.account}','${id(88)}',now()+interval '-1 second')`);
  const ticket=await generic();assert(ticket?.token);
  assert.equal(await scalar('select voice_job_id from icash_automation_tickets where token=$1',[ticket.token]),id(89));
 });
 for(const state of ['issued','dispatching','provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'])await scenario(state+' blocks the same account',async()=>{
  const held=state.startsWith('provider_');
  await pg.query('update icash_voice_jobs set state=$1,outcome=$2 where id=$3',[held?'held':state,held?state:null,first.job]);
  await unchangedWait();
  assert.equal((await prepare(other.lead)).voiceJobId,other.job,'different account and contact are not globally blocked');
 });
 for(const state of ['issued','dispatching','provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'])await scenario(state+' blocks the same contact across accounts',async()=>{
  const held=state.startsWith('provider_');
  await pg.exec(`insert into icash_operational_contacts select '${id(80)}','${other.account}',contact_key from icash_contact_permissions where id='${second.permission}';
   insert into icash_voice_jobs(id,account_id,operational_contact_id,state,outcome) values('${id(81)}','${other.account}','${id(80)}','${held?'held':state}',${held?"'"+state+"'":'null'});`);
  await unchangedWait();
 });
 for(const state of ['waiting','review'])for(const sameAccount of [true,false])await scenario('live '+state+' blocks '+(sameAccount?'account':'contact'),async()=>{
  await pg.exec(`insert into icash_live_conversations select '${sameAccount?second.account:other.account}',${sameAccount?"'different-contact'":'contact_key'},'${state}','SIMULATION live' from icash_contact_permissions where id='${second.permission}'`);
  await unchangedWait();
 });
 await scenario('missing target does not hide an account conflict',async()=>{
  await pg.exec(`update icash_voice_jobs set state='dispatching',permission_id=null where id='${first.job}'`);await unchangedWait();
 });
 for(const state of ['ready','held','dispatched'])await scenario('nonblocking terminal or queued state '+state,async()=>{
  await pg.query('update icash_voice_jobs set state=$1,outcome=$2 where id=$3',[state,'SIMULATION confirmed terminal',first.job]);
  assert.equal((await prepare(second.lead)).voiceJobId,second.job);
 });
 await scenario('different-account live conversation is independent',async()=>{
  await pg.exec(`insert into icash_live_conversations values('${other.account}','different-contact','waiting','SIMULATION unrelated')`);
  assert.equal((await prepare(second.lead)).voiceJobId,second.job);
 });
 const leadWhere=`where lead_id='${second.lead}'`,permissionWhere=`where id='${second.permission}'`;
 for(const [label,change] of [
  ['account paused',`update icash_accounts set bot_paused=true where id='${second.account}'`],
  ['membership removed',`update icash_accounts set member=false where id='${second.account}'`],
  ['voice disabled',`update icash_accounts set voice_enabled=false where id='${second.account}'`],
  ['zero credits',`update icash_wallets set balance_cents=0 where account_id='${second.account}'`],
  ...['paused','voice_paused'].map(field=>[field,`update icash_meta_leads set ${field}=true ${leadWhere}`]),
  ['declined',`update icash_meta_leads set declined_at=now() ${leadWhere}`],
  ['future appointment',`update icash_voice_jobs set due_at=now()+interval '1 hour' where id='${second.job}'`],
  ['revoked permission',`update icash_contact_permissions set revoked_at=now() ${permissionWhere}`],
  ['expired permission',`update icash_contact_permissions set permission_until=now()-interval '1 second' ${permissionWhere}`],
  ['changed evidence',`update icash_contact_permissions set permission_evidence='stale' ${permissionWhere}`],
  ['changed timezone',`update icash_contact_permissions set timezone='America/Chicago' ${permissionWhere}`],
  ['changed expiry',`update icash_contact_permissions set permission_until=permission_until+interval '1 hour' ${permissionWhere}`],
  ['wrong contact key',`update icash_contact_permissions set contact_key='wrong' ${permissionWhere}`],
  ['wrong account',`update icash_contact_permissions set account_id='${other.account}' ${permissionWhere}`],
  ['wrong screening',`update icash_contact_permissions set screening_id='${other.screen}' ${permissionWhere}`],
  ['wrong lead',`update icash_contact_permissions set seller_intake_id='${other.lead}' ${permissionWhere}`],
  ['wrong phone',`update icash_contact_permissions set phone='${other.phone}' ${permissionWhere}`],
  ['source disabled',`update icash_meta_lead_sources set enabled=false where id='${second.source}'`],
  ['source expired',`update icash_meta_lead_sources set reviewed_until=now()-interval '1 second' where id='${second.source}'`],
  ['source binding changed',`update icash_meta_lead_sources set form_id='other-form' where id='${second.source}'`],
  ['consent withdrawn',`update icash_seller_intakes set ai_consented=false where id='${second.lead}'`],
  ['consent receipt false',`update icash_meta_leads set consent_receipt='[{"checkbox_key":"contact","is_checked":false}]' ${leadWhere}`],
  ['text opt-out',`insert into icash_text_suppressions values('${second.phone}')`],
  ['contact opt-out',`insert into icash_contact_suppressions select contact_key from icash_contact_permissions ${permissionWhere}`],
  ['manual handoff',`insert into icash_handoffs values('${second.account}','${second.screen}','waiting')`],
  ['closed deal',`update icash_deal_files set stage='closed' where id='${second.deal}'`],
 ])await scenario(label,async()=>{await pg.exec(change);await unchangedWait();assert.equal(await generic(),null,'loss of admission cannot redirect a current Meta initial job to the generic issuer');});
 await scenario('authenticated form-submission consent remains current',async()=>{
  await pg.exec(`update icash_meta_lead_sources set contact_basis='form_submission' where id='${second.source}';
   insert into icash_make_lead_inbox(meta_id,page_id,form_id,state,payload)
   select m.meta_id,m.page_id,m.form_id,'accepted',jsonb_build_object('created_time',m.submitted_at::text,'field_data',jsonb_build_array(jsonb_build_object('name','full_name','values',jsonb_build_array(l.name)),jsonb_build_object('name','phone_number','values',jsonb_build_array(l.phone))))
   from icash_meta_leads m join icash_seller_intakes l on l.id=m.lead_id where m.lead_id='${second.lead}';
   update icash_meta_leads set consent_receipt=jsonb_build_array(jsonb_build_object('kind','form_submission','provider','meta','metaId',meta_id,'pageId',page_id,'formId',form_id,'submittedAt',submitted_at::text)) where lead_id='${second.lead}';
   update icash_contact_permissions p set permission_evidence=icash_seller_contact_evidence(p.account_id,p.screening_id,p.seller_intake_id,p.phone)->>'evidence' where id='${second.permission}';`);
  assert.equal((await prepare(second.lead)).voiceJobId,second.job);
  await pg.exec(`update icash_voice_jobs set state='ready' where id='${second.job}';update icash_make_lead_inbox set payload=jsonb_set(payload,'{field_data,1,values,0}','"+12025550999"')`);
  await unchangedWait();assert.equal(await generic(),null,'changed submission cannot escape through the generic issuer');
 });
 await scenario('held failures and their cancelled spend are not reopened',async()=>{
  await pg.exec(`update icash_voice_jobs set state='held',outcome='dispatch_permission_changed' where id='${second.job}'`);
  await unchangedWait();
 });
 // The owner's separately deployed hours policy may arrive before or after
 // this migration. Apply its exact Meta final-claim patch with a controlled
 // clock dependency, then apply both scheduler changes again from their old
 // definitions. The independent first-contact-hours suites test the real clock.
 await pg.exec(`create table fixture_voice_hours(open boolean);insert into fixture_voice_hours values(false);
  create function icash_voice_outreach_hours_current(uuid,uuid) returns boolean language sql stable as $$select open from public.fixture_voice_hours$$;`);
 const hoursSql=read('config/first-contact-voice-hours.sql');
 const hoursStart=hoursSql.indexOf(" signature:='public.icash_meta_claim_voice(uuid,uuid)';");
 const hoursEnd=hoursSql.indexOf('\n\n -- A verified contract-cancellation',hoursStart);
 assert(hoursStart>0&&hoursEnd>hoursStart);
 await pg.exec('do $hours$ declare definition text;needle text;signature text;begin '+hoursSql.slice(hoursStart,hoursEnd)+' end $hours$;');
 const hoursClaim=await scalar("select pg_get_functiondef('icash_meta_claim_voice(uuid,uuid)'::regprocedure)");
 assert(hoursClaim.includes('if not public.icash_voice_outreach_hours_current(p_account,p_job) then return false;end if;'));
 await pg.exec(oldDefinition);await pg.exec(oldGeneric);await pg.exec(sql);
 assert.equal(await scalar("select pg_get_functiondef('icash_meta_claim_voice(uuid,uuid)'::regprocedure)"),hoursClaim,'scheduler migration preserves the owner hours policy byte-for-byte');
 await scenario('owner hours guard still controls final admission',async()=>{
  assert.equal((await prepare(first.lead)).voiceJobId,first.job);
  await pg.exec(`insert into icash_operation_spend(operation_key,account_id,rate_id) values('voice:${first.job}','${first.account}','${id(90)}');`);
  const before=await row('icash_operation_spend','operation_key','voice:'+first.job);
  assert.equal(await scalar('select icash_meta_claim_voice($1,$2)',[first.account,first.job]),false,'first contact remains blocked outside the owner business window');
  assert.deepEqual(await row('icash_operation_spend','operation_key','voice:'+first.job),before);
  await pg.exec('update fixture_voice_hours set open=true');
  assert.equal(await scalar('select icash_meta_claim_voice($1,$2)',[first.account,first.job]),true,'normal valid-hours final claim remains available');
  await unchangedWait();assert.equal(await generic(),null);
 });
 // Fail closed if a future migration changes the critical serialized section.
 await pg.exec('begin');
 await pg.exec(oldDefinition.replace('perform 1 from public.icash_operating_budget where id=1 for update;','-- Missing lock fixture.'));
 await assert.rejects(pg.exec(sql.replace(/^begin;\n/,'').replace(/commit;\n$/,'')),/serialization prerequisite changed/);
 await pg.exec('rollback');
 // A changed generic prerequisite rolls back the already-applied Meta gate too.
 await pg.exec(oldDefinition);
 const alteredGeneric=oldGeneric.replace("where v.state='ready' and v.due_at<=now()", "where v.state='ready' and (v.due_at<=now())");
 assert.notEqual(alteredGeneric,oldGeneric);await pg.exec(alteredGeneric);
 await assert.rejects(pg.exec(sql),/generic voice routing prerequisite changed/);
 await pg.exec('rollback');
 assert.equal(await scalar("select pg_get_functiondef('icash_meta_prepare_voice(uuid)'::regprocedure)"),oldDefinition,'failed migration never leaves a partial scheduler patch');
 assert.equal(await scalar("select pg_get_functiondef('icash_next_before_fulfillment()'::regprocedure)"),alteredGeneric);
 await pg.exec(currentDefinition);await pg.exec(currentGeneric);
 assert.equal(await scalar('select count(*)::int from icash_voice_jobs'),3);
 assert.equal(await scalar('select count(*)::int from icash_operation_spend'),1);
 assert.equal((await row('icash_operation_spend','operation_key','voice:SIMULATION-cancelled')).state,'cancelled');
 console.log('PASS Meta initial voice serialization: reproduced double issuance, pre-reservation account/contact waiting, unknown-outcome protection, generic-route exclusion and non-Meta continuity, independent accounts, completion release, real consent/binding guards, unchanged pre/post business-hours final claim and cancelled spend, no replacements or provider calls.');
}finally{await pg.close();}
