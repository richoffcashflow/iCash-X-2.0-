// LOCAL SIMULATION ONLY. Synthetic records, no providers or production data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create();
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),lead=id(2),screen=id(3),deal=id(4),job=id(5),permission=id(6),source=id(7),thread=id(8);
const scalar=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0])[0];
function definition(file,name){
 const found=read('config/'+file+'.sql').match(new RegExp(`create(?: or replace)? function public\\.${name}\\([^]*?\\$\\$;`,'i'));
 assert(found,`SQL definition exists: ${name}`);return found[0];
}
const findings=async()=>{
 await pg.exec('begin read only;set local role service_role');
 try{return(await pg.query('select * from public.icash_undispatched_outreach_findings()')).rows;}
 finally{await pg.exec('rollback');}
};
async function scenario(label,sql,expected=0){
 await pg.exec('begin');
 try{
  await pg.exec(sql);
  const before=await scalar("select jsonb_agg(to_jsonb(j) order by id) from icash_voice_jobs j");
  // Stable invoker monitor is allowed only reads, even through shared validators.
  await pg.exec('set local transaction read only;set local role service_role');
  const rows=(await pg.query('select * from icash_undispatched_outreach_findings()')).rows;
  assert.equal(rows.length,expected,label);
  assert.deepEqual(await scalar("select jsonb_agg(to_jsonb(j) order by id) from icash_voice_jobs j"),before,`${label}: never mutates jobs`);
 }finally{await pg.exec('rollback');}
}
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,bot_paused boolean default false,member boolean default true,sms_enabled boolean default true,voice_enabled boolean default true);
 create table icash_wallets(account_id uuid primary key,balance_cents bigint);
 create table icash_billing_reviews(account_id uuid,resolved_at timestamptz);
 create table icash_customer_identities(account_id uuid primary key,principal text);
 create table icash_seller_intakes(id uuid primary key,phone text,name text,address text,state text,canonical_id uuid,assigned_account uuid,screening_id uuid,ai_consented boolean,consent_text text,consent_version text,contact_consent_scope text,sharing_text text,data_rights_until timestamptz);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb default '{}',result jsonb,completed_at timestamptz);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb default '{}');
 create table icash_seller_responses(lead_id uuid,account_id uuid,screening_id uuid,state text,created_at timestamptz);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table icash_handoffs(account_id uuid,screening_id uuid,state text);
 create table icash_text_suppressions(phone text);
 create table icash_contact_suppressions(contact_key text);
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,seller_intake_id uuid,party text default 'seller',recipient text,retired_at timestamptz,manual_only boolean default false,ai_mode text default 'auto',paused boolean default false,sms_intake_pending boolean default false,timezone text default 'UTC');
 create table icash_text_messages(id uuid primary key,thread_id uuid,account_id uuid,direction text,state text,provider_id text);
 create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,seller_intake_id uuid,phone text,party text default 'seller',revoked_at timestamptz,permission_until timestamptz,dnc_clear boolean default false,dnc_checked_at timestamptz,review_request_id uuid,buyer_id uuid,contact_key text,timezone text,local_start_hour int default 9,local_end_hour int default 20,permission_evidence text);
 create table icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid,state text,due_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now(),callback_id uuid,sms_source_message_id uuid,cancellation_notice_id uuid,operational_contact_id uuid,meta_offer_lead_id uuid,meta_retry_of uuid,meta_followup_lead_id uuid,provider_call_sid text,conversation_id text,operation_key text,outcome text);
 create table icash_meta_leads(lead_id uuid primary key,account_id uuid,screening_id uuid,source_id uuid,voice_job_id uuid,paused boolean default false,voice_paused boolean default false,declined_at timestamptz,response_at timestamptz,address_confirmed_at timestamptz,contact_until timestamptz,submitted_at timestamptz,meta_id text,page_id text,form_id text,consent_text text,consent_version text,timezone text,consent_receipt jsonb);
 create table icash_meta_lead_sources(id uuid primary key,account_id uuid,routing_mode text,principal text,enabled boolean default true,reviewed_until timestamptz,page_id text,form_id text,consent_text text,consent_version text,timezone text,sharing_text text,contact_basis text default 'checkbox',consent_key text,test_lead_names text[] default '{}');
 create table icash_make_lead_inbox(meta_id text,page_id text,form_id text,is_test boolean default false,state text,payload jsonb);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table icash_call_recordings(id uuid primary key,account_id uuid,voice_job_id uuid,operation_key text,call_sid text,state text,start_claimed_at timestamptz,recording_sid text,conversation_id text);
 create table icash_recorded_gate_terminal_receipts(recording_id uuid,account_id uuid,call_sid text,receipt jsonb);
 create table icash_fulfillment_jobs(id uuid primary key,account_id uuid,deal_id uuid,state text,updated_at timestamptz);
 create table icash_operation_spend(operation_key text);
 -- Controlled membership/channel inputs; their full admission suites remain in
 -- the release gate. Actual source receipts and permission binding run below.
 create function icash_membership_work_allowed(uuid) returns boolean language sql stable as $$select member from public.icash_accounts where id=$1$$;
 create function icash_outreach_sms_current(uuid) returns boolean language sql stable as $$select sms_enabled from public.icash_accounts where id=$1$$;
 create function icash_outreach_voice_current(uuid) returns boolean language sql stable as $$select voice_enabled from public.icash_accounts where id=$1$$;
 create function icash_buyer_outreach_running(uuid,uuid) returns boolean language sql stable as $$select true$$;
 create function icash_seller_sms_permission_current(uuid,uuid,boolean) returns boolean language sql stable as $$select true$$;
 create function icash_sms_message_route_current(uuid,uuid) returns boolean language sql stable as $$select true$$;
 create function icash_seller_sms_inquiry_window(uuid,uuid) returns boolean language sql stable as $$select false$$;
 create function icash_prepare_seller_responses(uuid) returns boolean language sql as $$select exists(select 1 from icash_voice_jobs v join icash_contact_permissions p on p.id=v.permission_id where true and v.state='dispatched' and v.provider_call_sid is not null)$$;
 create function icash_seller_evidence_before_meta(uuid,uuid,uuid,text) returns jsonb language sql as $$select null::jsonb$$;
 `);
 await pg.exec(definition('meta-make-intake','icash_meta_contact_receipt_current'));
 await pg.exec(definition('meta-test-contact-exclusion','icash_meta_is_test_contact'));
 let pool=definition('meta-instant-network-pool','icash_meta_pool_receipt_current');
 const legacyReceipt="and (select count(*) from jsonb_array_elements(m.consent_receipt) e where e->>'checkbox_key'=src.consent_key)=1\n and exists(select 1 from jsonb_array_elements(m.consent_receipt) e where e->>'checkbox_key'=src.consent_key and e->'is_checked'='true'::jsonb)";
 assert(pool.includes(legacyReceipt));
 pool=pool.replace(legacyReceipt,"and public.icash_meta_contact_receipt_current(src.id,jsonb_build_object('metaId',m.meta_id,'pageId',m.page_id,'formId',m.form_id,'submittedAt',m.consent_receipt->0->>'submittedAt','name',l.name,'phone',l.phone,'consentResponses',m.consent_receipt))");
 await pg.exec(pool);
 // Real production evidence functions seed hashes independently of the monitor,
 // so a duplicated or incomplete JSON binding cannot accidentally pass the test.
 let direct=definition('meta-instant-leads','icash_seller_contact_evidence').replace('function public.icash_seller_contact_evidence','function public.icash_meta_direct_contact_evidence');
 const consentCheck="or l.consent_version is distinct from m.consent_version or l.consent_text is distinct from m.consent_text";
 direct=direct.replace(consentCheck,consentCheck+" or not public.icash_meta_contact_receipt_current(m.source_id,jsonb_build_object('metaId',m.meta_id,'pageId',m.page_id,'formId',m.form_id,'submittedAt',m.consent_receipt->0->>'submittedAt','name',l.name,'phone',l.phone,'consentResponses',m.consent_receipt))");
 await pg.exec(direct);
 await pg.exec(definition('meta-instant-network-pool','icash_seller_contact_evidence'));
 await pg.exec(definition('seller-intake-contacts','icash_seller_voice_permission_current'));
 await pg.exec(definition('undispatched-work-monitoring','icash_undispatched_outreach_findings'));
 await pg.exec("revoke all on function icash_undispatched_outreach_findings() from public,anon,authenticated;grant execute on function icash_undispatched_outreach_findings() to service_role;");
 await pg.exec(read('config/recorded-seller-attempt-progress.sql'));
 await pg.exec(read('config/scheduled-seller-sms-monitoring.sql'));
 await pg.exec(read('config/anytime-seller-monitoring.sql'));
 const oldDefinition=await scalar("select pg_get_functiondef('icash_undispatched_outreach_findings()'::regprocedure)");
 const sql=read('config/meta-initial-voice-monitoring.sql');
 assert.equal(sql,read('supabase/migrations/20261019165317_meta_initial_voice_monitoring.sql'));
 await pg.exec(sql);
 const currentDefinition=await scalar("select pg_get_functiondef('icash_undispatched_outreach_findings()'::regprocedure)");
 const metaStart=currentDefinition.indexOf(" union all\n select 'seller_response',m.screening_id");
 const buyerStart=currentDefinition.indexOf(" union all\n select 'buyer_fulfillment'");
 assert(metaStart>0&&buyerStart>metaStart);
 assert.equal(currentDefinition.slice(0,metaStart)+currentDefinition.slice(buyerStart),oldDefinition,'all existing monitoring and scheduled-SMS/recorded receipt behavior is byte-for-byte preserved');
 assert.equal(await scalar("select prosecdef from pg_proc where oid='icash_undispatched_outreach_findings()'::regprocedure"),false);
 assert.equal(await scalar("select provolatile from pg_proc where oid='icash_undispatched_outreach_findings()'::regprocedure"),'s');
 await pg.exec('grant select on all tables in schema public to service_role');
 for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_function_privilege($1,'icash_undispatched_outreach_findings()','execute')",[role]),false);
 await pg.exec(`
 insert into icash_accounts(id) values('${account}');
 insert into icash_wallets values('${account}',1000);
 insert into icash_customer_identities values('${account}','SIMULATION Buyer');
 insert into icash_seller_intakes(id,phone,name,state,assigned_account,screening_id,ai_consented,consent_text,consent_version,contact_consent_scope,sharing_text,data_rights_until)
 values('${lead}','+12025550123','SIMULATION Seller','awaiting_address','${account}','${screen}',true,'SIMULATION contact consent','fixture-v1','homeoffer_network_and_matched_buyers','SIMULATION sharing',now()+interval '2 days');
 insert into icash_screening_jobs(id,account_id,state,snapshot) values('${screen}','${account}','awaiting_address','{"propertyId":"fixture-property"}');
 insert into icash_deal_files(id,account_id,screening_id,stage) values('${deal}','${account}','${screen}','draft');
 insert into icash_meta_lead_sources(id,routing_mode,principal,reviewed_until,page_id,form_id,consent_text,consent_version,timezone,sharing_text,consent_key)
 values('${source}','network_pool','HomeOffer Network',now()+interval '2 days','111111','222222','SIMULATION contact consent','fixture-v1','UTC','SIMULATION sharing','contact');
 insert into icash_meta_leads(lead_id,account_id,screening_id,source_id,voice_job_id,contact_until,submitted_at,meta_id,page_id,form_id,consent_text,consent_version,timezone,consent_receipt)
 values('${lead}','${account}','${screen}','${source}','${job}',now()+interval '2 days',now()-interval '1 hour','333333','111111','222222','SIMULATION contact consent','fixture-v1','UTC','[{"checkbox_key":"contact","is_checked":true}]');
 insert into icash_contact_permissions(id,account_id,screening_id,seller_intake_id,phone,permission_until,contact_key,timezone,permission_evidence)
 select '${permission}','${account}','${screen}','${lead}',l.phone,m.contact_until,encode(sha256(convert_to(l.phone,'UTF8')),'hex'),m.timezone,icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone)->>'evidence'
 from icash_seller_intakes l join icash_meta_leads m on m.lead_id=l.id;
 insert into icash_voice_jobs(id,account_id,permission_id,state,created_at,outcome) values('${job}','${account}','${permission}','held',now()-interval '6 minutes','production_agent_review_required');
 insert into icash_text_threads(id,account_id,deal_id,seller_intake_id,recipient) values('${thread}','${account}','${deal}','${lead}','+12025550123');
 `);
 assert.equal(await scalar('select icash_seller_voice_permission_current($1,$2)',[account,permission]),true,'real permission function independently confirms fixture binding');
 let rows=await findings();
 assert.equal(rows.length,1,'held initial Meta call cannot disappear behind incomplete screening');
 assert.equal(rows[0].kind,'seller_response');assert.equal(rows[0].resource_id,screen);assert.equal(rows[0].account_id,account);
 assert(!JSON.stringify(rows).includes('SIMULATION'));assert(!JSON.stringify(rows).includes('+1202'),'findings disclose identifiers, not contact data');
 for(const [label,change] of [
  ['new job',"update icash_voice_jobs set created_at=now()"],
  ['explicit future schedule',"update icash_voice_jobs set due_at=now()+interval '1 hour'"],
  ['cancelled job',"update icash_voice_jobs set state='canceled'"],
  ['not the current job',"update icash_meta_leads set voice_job_id=null"],
  ...['callback_id','sms_source_message_id','cancellation_notice_id','operational_contact_id','meta_offer_lead_id','meta_retry_of','meta_followup_lead_id'].map(field=>[field,`update icash_voice_jobs set ${field}='${id(90)}'`]),
  ...['paused','voice_paused'].map(field=>[field,`update icash_meta_leads set ${field}=true`]),
  ...['declined_at','response_at','address_confirmed_at'].map(field=>[field,`update icash_meta_leads set ${field}=now()`]),
  ['address known',"update icash_seller_intakes set address='SIMULATION address'"],
  ['lead no longer awaiting address',"update icash_seller_intakes set state='review'"],
  ['screening advanced',"update icash_screening_jobs set state='complete'"],
  ['duplicate lead',`update icash_seller_intakes set canonical_id='${id(90)}'`],
  ['wrong account',`update icash_contact_permissions set account_id='${id(90)}'`],
  ['wrong screening',`update icash_contact_permissions set screening_id='${id(90)}'`],
  ['wrong lead',`update icash_contact_permissions set seller_intake_id='${id(90)}'`],
  ['wrong phone',"update icash_contact_permissions set phone='+12025550124'"],
  ['revoked consent',"update icash_contact_permissions set revoked_at=now()"],
  ['expired consent',"update icash_contact_permissions set permission_until=now()-interval '1 hour'"],
  ['changed evidence',"update icash_contact_permissions set permission_evidence='stale evidence'"],
  ['wrong contact key',"update icash_contact_permissions set contact_key='wrong'"],
  ['wrong permission timezone',"update icash_contact_permissions set timezone='America/Chicago'"],
  ['wrong permission expiry',"update icash_contact_permissions set permission_until=permission_until+interval '1 minute'"],
  ['wrong party',"update icash_contact_permissions set party='buyer'"],
  ['DNC record is not intake consent',"update icash_contact_permissions set dnc_clear=true"],
  ['changed permission hours',"update icash_contact_permissions set local_start_hour=10"],
  ['source disabled',"update icash_meta_lead_sources set enabled=false"],
  ['source expired',"update icash_meta_lead_sources set reviewed_until=now()-interval '1 second'"],
  ['source form changed',"update icash_meta_lead_sources set form_id='444444'"],
  ['source version changed',"update icash_meta_lead_sources set consent_version='fixture-v2'"],
  ['consent not checked',`update icash_meta_leads set consent_receipt='[{"checkbox_key":"contact","is_checked":false}]'`],
  ['nonconsented intake',"update icash_seller_intakes set ai_consented=false"],
  ['wrong consent scope',"update icash_seller_intakes set contact_consent_scope='icash_x_demo'"],
  ['wrong sharing evidence',"update icash_seller_intakes set sharing_text='changed'"],
  ['expired data rights',"update icash_seller_intakes set data_rights_until=now()-interval '1 second'"],
  ['future submission',"update icash_meta_leads set submitted_at=now()+interval '1 hour'"],
  ['stale submission',"update icash_meta_leads set submitted_at=now()-interval '31 days'"],
  ['excluded test contact',"update icash_meta_lead_sources set test_lead_names=array['SIMULATION Seller']"],
  ['account paused',"update icash_accounts set bot_paused=true"],
  ['membership absent',"update icash_accounts set member=false"],
  ['voice disabled',"update icash_accounts set voice_enabled=false"],
  ['zero credits',"update icash_wallets set balance_cents=0"],
  ['billing hold',`insert into icash_billing_reviews values('${account}',null)`],
  ['manual property',`insert into icash_property_controls values('${account}','fixture-property',true)`],
  ['unresolved handoff',`insert into icash_handoffs values('${account}','${screen}','waiting')`],
  ['text opt-out',"insert into icash_text_suppressions values('+12025550123')"],
  ['contact opt-out',"insert into icash_contact_suppressions select contact_key from icash_contact_permissions"],
  ['manual thread',"update icash_text_threads set manual_only=true"],
  ['AI stopped',"update icash_text_threads set ai_mode='off'"],
  ['thread paused',"update icash_text_threads set paused=true"],
  ['reply receipt before projection',`insert into icash_text_messages values('${id(20)}','${thread}','${account}','incoming','received',null)`],
  ['practice deal',`update icash_deal_files set terms='{"practice":true}'`],
  ['explicit deal hold',`update icash_deal_files set terms='{"testHold":true}'`],
  ['closed deal',"update icash_deal_files set stage='closed'"],
  ['real provider attempt',"update icash_voice_jobs set state='dispatched',provider_call_sid='SIMULATION completed'"],
 ])await scenario(label,change);
 for(const state of ['ready','issued','dispatching','dispatched'])await scenario(state+': overdue call without a real attempt stays visible',`update icash_voice_jobs set state='${state}'`,1);
 for(const outcome of ['provider_outcome_unknown_no_retry','provider_receipt_needs_reconciliation','ended_before_recording'])await scenario(outcome+': uncertainty stays visible without redial',`update icash_voice_jobs set outcome='${outcome}',provider_call_sid='SIMULATION uncertain',operation_key='voice:${job}'`,1);
 for(const terminal of ['no-answer','busy','completed'])await scenario('bound terminal receipt '+terminal,`
 update icash_voice_jobs set outcome='ended_before_recording',provider_call_sid='SIMULATION terminal',operation_key='voice:${job}';
 insert into icash_call_recordings(id,account_id,voice_job_id,operation_key,call_sid,state) values('${id(30)}','${account}','${job}','voice:${job}','SIMULATION terminal','failed');
 insert into icash_recorded_gate_terminal_receipts values('${id(30)}','${account}','SIMULATION terminal','{"sid":"SIMULATION terminal","status":"${terminal}"}');`);
 const rebind="update icash_contact_permissions p set permission_evidence=icash_seller_contact_evidence(p.account_id,p.screening_id,p.seller_intake_id,p.phone)->>'evidence'";
 await scenario('direct source uses exact principal-bound evidence',`update icash_meta_lead_sources set routing_mode='direct',account_id='${account}',principal='SIMULATION Buyer';update icash_seller_intakes set contact_consent_scope='meta_direct_principal';${rebind}`,1);
 await scenario('direct wrong principal stays excluded',`update icash_meta_lead_sources set routing_mode='direct',account_id='${account}',principal='Other principal';update icash_seller_intakes set contact_consent_scope='meta_direct_principal';${rebind}`);
 // Submission consent is validated against the immutable authenticated receipt,
 // not invented checkbox evidence or a fabricated call-now authorization.
 await pg.exec(`
 update icash_meta_lead_sources set contact_basis='form_submission';
 insert into icash_make_lead_inbox(meta_id,page_id,form_id,state,payload)
 select m.meta_id,m.page_id,m.form_id,'accepted',jsonb_build_object('created_time',m.submitted_at::text,'field_data',jsonb_build_array(jsonb_build_object('name','full_name','values',jsonb_build_array(l.name)),jsonb_build_object('name','phone_number','values',jsonb_build_array(l.phone))))
 from icash_meta_leads m join icash_seller_intakes l on l.id=m.lead_id;
 update icash_meta_leads set consent_receipt=jsonb_build_array(jsonb_build_object('kind','form_submission','provider','meta','metaId',meta_id,'pageId',page_id,'formId',form_id,'submittedAt',submitted_at::text));
 ${rebind};`);
 assert.equal(await scalar('select icash_seller_voice_permission_current($1,$2)',[account,permission]),true);
 assert.equal((await findings()).length,1,'real form submission remains monitorable');
 await scenario('test connector receipt',"update icash_make_lead_inbox set is_test=true");
 await scenario('missing connector receipt',"delete from icash_make_lead_inbox");
 await scenario('changed connector phone',`update icash_make_lead_inbox set payload=jsonb_set(payload,'{field_data,1,values,0}','"+12025550124"')`);
 await scenario('changed submission receipt',`update icash_meta_leads set consent_receipt=jsonb_set(consent_receipt,'{0,submittedAt}','"2000-01-01"')`);
 // A normal linked recovery becomes the authoritative current initial job.
 // The original is retained for audit, and must never create a duplicate alert.
 const linked=id(40);
 await pg.exec(`
 insert into icash_voice_jobs(id,account_id,permission_id,meta_retry_of,state,created_at,outcome)
 values('${linked}','${account}','${permission}','${job}','held',now()-interval '7 minutes','production_agent_review_required');
 update icash_meta_leads set voice_job_id='${linked}';`);
 assert.equal((await findings()).length,0,'historical monitor reproduces the hidden current linked-call regression');
 const beforeLinkedPatch=await scalar("select pg_get_functiondef('icash_undispatched_outreach_findings()'::regprocedure)");
 const metadata=()=>scalar("select jsonb_build_object('securityDefiner',prosecdef,'volatility',provolatile,'acl',proacl::text,'settings',proconfig) from pg_proc where oid='icash_undispatched_outreach_findings()'::regprocedure");
 const previousMetadata=await metadata();
 const linkedSql=read('config/meta-current-initial-voice-monitoring.sql');
 const linkedMigration=readFileSync(new URL('../supabase/migrations/20261019180234_meta_current_initial_voice_monitoring.sql',import.meta.url),'utf8');
 assert.equal(linkedSql,linkedMigration);
 await pg.exec(linkedSql);
 assert.equal(await scalar("select pg_get_functiondef('icash_undispatched_outreach_findings()'::regprocedure)"),beforeLinkedPatch.replace(linkedSql.split('$old$')[1],linkedSql.split('$new$')[1]),'only linked-initial scope changes; every existing guard remains identical');
 assert.deepEqual(await metadata(),previousMetadata,'preserve STABLE/INVOKER, empty search_path and exact service-only ACLs');
 rows=await findings();assert.equal(rows.length,1,'current linked initial hold is visible exactly once');
 assert.equal(rows[0].resource_id,screen);assert.equal(rows[0].account_id,account);assert.equal(rows[0].kind,'seller_response');
 assert.deepEqual(rows[0].since,await scalar('select created_at from icash_voice_jobs where id=$1',[linked]),'age comes from the authoritative current job, not its predecessor');
 for(const [label,change,expected=0] of [
  ['linked job receives its own grace period',`update icash_voice_jobs set created_at=now() where id='${linked}'`],
  ['future linked appointment',`update icash_voice_jobs set due_at=now()+interval '1 hour' where id='${linked}'`],
  ['no authoritative current job',"update icash_meta_leads set voice_job_id=null"],
  ['historical replacement is ignored when original is current',`update icash_meta_leads set voice_job_id='${job}'`,1],
  ['missing predecessor',`update icash_voice_jobs set meta_retry_of='${id(99)}' where id='${linked}'`],
  ['self-linked job',`update icash_voice_jobs set meta_retry_of=id where id='${linked}'`],
  ['cross-account predecessor',`update icash_voice_jobs set account_id='${id(99)}' where id='${job}'`],
  ['unrelated predecessor permission',`update icash_voice_jobs set permission_id='${id(99)}' where id='${job}'`],
  ...['callback_id','sms_source_message_id','cancellation_notice_id','operational_contact_id','meta_offer_lead_id','meta_followup_lead_id'].map(field=>['linked '+field,`update icash_voice_jobs set ${field}='${id(99)}' where id='${linked}'`]),
  ...['callback_id','sms_source_message_id','cancellation_notice_id','operational_contact_id','meta_offer_lead_id','meta_followup_lead_id','meta_retry_of'].map(field=>['non-original predecessor '+field,`update icash_voice_jobs set ${field}='${id(99)}' where id='${job}'`]),
  ['linked source test exclusion',"update icash_make_lead_inbox set is_test=true"],
  ['linked source disabled',"update icash_meta_lead_sources set enabled=false"],
  ['linked revoked permission',"update icash_contact_permissions set revoked_at=now()"],
  ['linked voice pause',"update icash_meta_leads set voice_paused=true"],
  ['linked account pause',"update icash_accounts set bot_paused=true"],
  ['linked opt-out',"insert into icash_text_suppressions values('+12025550123')"],
  ['linked manual takeover',"update icash_text_threads set manual_only=true"],
  ['linked zero credits',"update icash_wallets set balance_cents=0"],
  ['linked membership hold',"update icash_accounts set member=false"],
  ['linked recorded dispatch clears while original remains held',`update icash_voice_jobs set state='dispatched',provider_call_sid='SIMULATION linked dispatch' where id='${linked}'`],
  ['unrelated replacement is ignored',`insert into icash_voice_jobs(id,account_id,permission_id,meta_retry_of,state,created_at) values('${id(41)}','${account}','${permission}','${id(42)}','held',now()-interval '1 hour')`,1],
  ['linked uncertain provider outcome stays visible without mutation',`update icash_voice_jobs set outcome='provider_outcome_unknown_no_retry',provider_call_sid='SIMULATION unknown' where id='${linked}'`,1],
 ])await scenario(label,change,expected);
 for(const terminal of ['no-answer','busy','completed'])await scenario('linked bound terminal receipt clears without counting historical original: '+terminal,`
 update icash_voice_jobs set outcome='ended_before_recording',provider_call_sid='SIMULATION linked terminal',operation_key='voice:${linked}' where id='${linked}';
 insert into icash_call_recordings(id,account_id,voice_job_id,operation_key,call_sid,state) values('${id(43)}','${account}','${linked}','voice:${linked}','SIMULATION linked terminal','failed');
 insert into icash_recorded_gate_terminal_receipts values('${id(43)}','${account}','SIMULATION linked terminal','{"sid":"SIMULATION linked terminal","status":"${terminal}"}');`);
 assert.equal(await scalar('select state from icash_voice_jobs where id=$1',[job]),'held','historical original remains untouched');
 assert.equal(await scalar('select state from icash_voice_jobs where id=$1',[linked]),'held','monitor never requeues the linked hold');
 assert.equal(await scalar('select count(*)::int from icash_operation_spend'),0,'monitor never reserves spend');
 console.log('PASS Meta initial voice monitoring: lock-free service-only observation, exact source/permission binding, manual/consent/credit guards, future appointments, genuine receipts, uncertain outcomes, authoritative original/linked initial scope, no duplicate historical finding and unchanged existing monitor.');
}finally{await pg.close();}
