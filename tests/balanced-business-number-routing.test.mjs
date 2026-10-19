import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.argv[2]?pathToFileURL(process.argv[2]).href:'@electric-sql/pglite');
const db=await PGlite.create();
const account='00000000-0000-4000-8000-000000000001',screen='00000000-0000-4000-8000-000000000002',deal='00000000-0000-4000-8000-000000000003';
const other='00000000-0000-4000-8000-000000000004',otherScreen='00000000-0000-4000-8000-000000000005',otherDeal='00000000-0000-4000-8000-000000000006';
const primary='+14243948384',secondary='+17208134296',retired='+14244377030',recipient='+12025550101';
const q=(sql,args=[])=>db.query(sql,args),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
const sender=async(fn='icash_property_call_sender',a=account,s=screen,p=recipient)=>(await one(`select ${fn}($1,$2,$3) sender`,[a,s,p])).sender;
const sms=()=>sender('icash_property_text_sender',account,deal);
const manual=()=>sender('icash_customer_call_sender');
const thread=(phone,acc=account,d=deal,party='seller')=>q('insert into icash_text_threads(account_id,deal_id,sender,recipient,party) values($1,$2,$3,$4,$5)',[acc,d,phone,recipient,party]);
const recorded=(phone,state='waiting',acc=account,s=screen)=>q('insert into icash_call_recordings(account_id,screening_id,from_phone,to_phone,party,state) values($1,$2,$3,$4,\'seller\',$5)',[acc,s,phone,recipient,state]);
const customer=(phone,state='needs_review',acc=account,s=screen)=>q('insert into icash_customer_phone_calls(account_id,screening_id,business_phone,recipient_phone,state) values($1,$2,$3,$4,$5)',[acc,s,phone,recipient,state]);
const reset=async()=>{
 await db.exec('truncate icash_text_threads,icash_call_recordings,icash_customer_phone_calls,icash_sms_routes,role_conflicts,icash_text_suppressions,icash_webinar_phone_suppressions,icash_contact_suppressions;update icash_text_senders set enabled=phone in (\'+14243948384\',\'+17208134296\');update icash_business_voice_numbers set outbound_enabled=true,forwarding_ready=true,caller_id_sid=\'PN\'||repeat(\'b\',32);update manual_contacts set blocked=false;update icash_accounts set bot_paused=false;');
};
try{
 await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema icash_recording_private;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
 create table icash_screening_jobs(id uuid primary key,account_id uuid);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid);
 create table icash_text_senders(phone text primary key,enabled boolean);
 create table icash_webinar_text_senders(phone text primary key,enabled boolean,preferred boolean);
 create table icash_business_voice_numbers(phone text primary key,outbound_enabled boolean,forwarding_ready boolean,caller_id_sid text);
 create table icash_text_threads(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,sender text,recipient text,party text,retired_at timestamptz,paused boolean default false,owner_buyer_test_id uuid);
 create view icash_non_test_text_threads as select * from icash_text_threads where owner_buyer_test_id is null;
 create table icash_sms_routes(sender text,recipient text,account_id uuid,needs_review boolean default false);
 create table icash_text_suppressions(phone text);create table icash_webinar_phone_suppressions(phone text);create table icash_contact_suppressions(contact_key text);
 create table role_conflicts(sender text,recipient text);
 create function icash_text_role_conflict(text,text) returns boolean language sql stable as $$select exists(select 1 from public.role_conflicts where sender=$1 and recipient=$2)$$;
 create table manual_contacts(account_id uuid,screening_id uuid,phone text,blocked boolean default false);
 create function icash_manual_contacts(uuid,uuid) returns table(phone text,blocked boolean) language sql stable as $$select phone,blocked from public.manual_contacts where account_id=$1 and screening_id=$2$$;
 create table icash_call_recordings(id uuid primary key default gen_random_uuid(),account_id uuid,screening_id uuid,from_phone text,to_phone text,party text,state text default 'waiting',operation_key text unique,entry_policy text,provider_account_sid text,call_sid text,nonce_hash text,stop_token_hash text,disclosure_version text,pricing_policy jsonb,branch_id text,version_id text,call_context jsonb,dial_claimed_at timestamptz,voice_job_id uuid,permission_id uuid,operational_contact_id uuid,contact_key text,agent_id text,rate_id uuid,charge_cap_cents bigint,max_total_seconds integer,created_at timestamptz,consent_deadline_at timestamptz,updated_at timestamptz,next_reconcile_at timestamptz);
 create table icash_customer_phone_calls(id uuid primary key default gen_random_uuid(),account_id uuid,actor_id uuid,screening_id uuid,callback_phone text,recipient_phone text,business_phone text,provider_account_sid text,nonce_hash text,operation_key text,rate_id uuid,state text default 'dispatching',ended_at timestamptz,created_at timestamptz default now(),recording_required boolean,recording_state text,connection_type text);
 create table icash_operating_budget(id integer primary key,enabled boolean,standard_cost_multiplier integer,elevenlabs_cost_multiplier integer);
 create table icash_operation_rates(id uuid primary key default gen_random_uuid(),operation text,version text,charge_cents bigint,costs_micros jsonb,buffer_bps integer,evidence_ref text,verified_at timestamptz,expires_at timestamptz,enabled boolean,voice_max_duration_seconds integer);
 create table icash_operation_spend(account_id uuid,operation_key text,rate_id uuid,state text,permission_until timestamptz,customer_price_micros bigint,charge_cap_cents bigint);
 create table icash_voice_jobs(id uuid primary key,account_id uuid,operation_key text,permission_id uuid,operational_contact_id uuid,state text,provider_call_sid text,conversation_id text);
 create table icash_voice_contact_targets(id uuid primary key,account_id uuid,screening_id uuid,party text,phone text,contact_key text,revoked_at timestamptz,permission_until timestamptz,dnc_clear boolean);
 create table icash_voice_configs(account_id uuid,agent_id text,enabled boolean,reviewed_until timestamptz,max_duration_seconds integer,seller_rate_id uuid,buyer_rate_id uuid);
 create table icash_live_conversations(operation_key text);
 create table icash_operational_contacts(id uuid,account_id uuid,screening_id uuid,phone text);
 create function icash_recording_private.clock_now() returns timestamptz language sql as $$select now()$$;
 create function icash_recording_private.keys(jsonb,text[],text[]) returns boolean language sql as $$select true$$;
 create function icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select '{"charge_cents":977,"max_seconds":600}'::jsonb$$;
 create function icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_manual_contact_reason(uuid,uuid,text,text) returns text language sql as $$select case when bot_paused then 'Paused' end from public.icash_accounts where id=$1$$;
 create function icash_reserve_operation(uuid,text,uuid,timestamptz) returns void language plpgsql as $$begin return;end$$;
 create function icash_claim_operation(text) returns boolean language sql as $$select true$$;
 create function icash_start_manual_call(uuid,uuid,uuid,text) returns jsonb language sql as $$select '{}'::jsonb$$;
 `);
 await q('insert into icash_accounts values($1,$1,false),($2,$2,false)',[account,other]);
 await q('insert into icash_screening_jobs values($1,$2),($3,$4)',[screen,account,otherScreen,other]);
 await q('insert into icash_text_senders values($1,true),($2,true),($3,false),(\'+12025550999\',true)',[primary,secondary,retired]);
 await q('insert into icash_webinar_text_senders values($1,true,false),($2,true,true)',[primary,secondary]);
 await q('insert into icash_business_voice_numbers values($1,true,true,$3),($2,true,true,$3)',[secondary,retired,'PN'+'b'.repeat(32)]);
 await q('insert into manual_contacts values($1,$2,$3,false)',[account,screen,recipient]);
 await db.exec(readFileSync('tests/fixtures/balanced-routing-admission.sql','utf8'));
 await db.exec(readFileSync('config/balanced-business-number-routing.sql','utf8'));

 const initially=await sender();assert([primary,secondary].includes(initially));
 assert.equal(await manual(),initially,'Manual and AI agree without a deal');
 await q('insert into icash_deal_files values($1,$2,$3),($4,$5,$6)',[deal,account,screen,otherDeal,other,otherScreen]);
 assert.equal(await sms(),initially,'Creating a draft must not change the hash key');
 const mix=(await q(`select icash_property_call_sender($1,$2,'+1202555'||lpad(i::text,4,'0')) sender,count(*) from generate_series(1000,1999) i group by sender`,[account,screen])).rows;
 assert.equal(mix.length,2);for(const row of mix)assert(Number(row.count)>430&&Number(row.count)<570,JSON.stringify(mix));
 await q('update icash_webinar_text_senders set preferred=not preferred');assert.equal(await sender(),initially,'Preferences cannot shift property allocation');
 const counts=()=>one('select (select count(*) from icash_call_recordings) calls,(select count(*) from icash_customer_phone_calls) manual,(select count(*) from icash_text_threads) threads,(select count(*) from icash_sms_routes) routes,(select bot_paused from icash_accounts where id=$1) paused',[account]);
 await q('update icash_accounts set bot_paused=true where id=$1',[account]);const before=await counts();
 await db.exec('begin read only');assert.equal(await sender(),initially);assert.equal(await manual(),initially);await db.exec('commit');
 assert.deepEqual(await counts(),before,'Eligibility and preview selection does not allocate, unpause or write');
 assert.equal(await sender('icash_property_call_sender',other,screen),null,'Account ownership');
 assert.equal(await sender('icash_property_call_sender',account,screen,'invalid'),null);
 await q('update manual_contacts set blocked=true');assert.equal(await manual(),null,'Manual contact permission');

 await reset();const alternate=initially===primary?secondary:primary;
 await thread(alternate);assert.equal(await sender(),alternate);assert.equal(await sms(),alternate);assert.equal(await manual(),alternate);
 await q('update icash_text_threads set paused=true');assert.equal(await sms(),alternate);assert.equal((await one('select paused from icash_text_threads')).paused,true,'Routing never releases a pause');
 await q('update icash_text_senders set enabled=false where phone=$1',[alternate]);assert.equal(await sender(),null,'Disabled established SMS route holds');
 await reset();await thread(primary);await thread(secondary);assert.equal(await sender(),null,'Conflicting SMS identities hold');
 await reset();await thread(primary);await recorded(secondary);assert.equal(await sender(),primary,'Exact SMS thread wins before call history');
 await reset();await thread(primary);await thread(primary,account,deal,'buyer');assert.equal(await sender(),null,'Mixed party exact route holds');
 for(const state of ['waiting','starting','active','failed','needs_review']){
  await reset();await recorded(alternate,state);assert.equal(await sender(),alternate,state);assert.equal(await sms(),alternate,'Call-first continuity '+state);assert.equal(await manual(),alternate);
 }
 for(const state of ['dispatching','ringing','connecting','completed','failed','needs_review']){
  await reset();await customer(alternate,state);assert.equal(await sms(),alternate,'Manual/browser continuity '+state);
 }
 await reset();await recorded(primary);await customer(secondary);assert.equal(await sender(),null,'Conflicting prior calls hold');
 await reset();await recorded(alternate);await q('update icash_text_senders set enabled=false where phone=$1',[alternate]);assert.equal(await sms(),null,'Disabled prior call identity holds');
 await reset();await recorded(secondary);await q('update icash_business_voice_numbers set forwarding_ready=false where phone=$1',[secondary]);assert.equal(await sms(),null,'Unverified established identity holds');
 await reset();await q('update icash_business_voice_numbers set caller_id_sid=null');assert.equal(await sender(),primary,'Unverified numbers excluded from new allocation');

 for(const table of ['icash_text_suppressions','icash_webinar_phone_suppressions']){
  await reset();await q(`insert into ${table} values($1)`,[recipient]);assert.equal(await sender(),null);assert.equal(await sms(),null);assert.equal(await manual(),null);
 }
 await reset();await q('insert into icash_contact_suppressions values(encode(sha256(convert_to($1,\'UTF8\')),\'hex\'))',[recipient]);assert.equal(await sender(),null);
 await reset();await q('insert into role_conflicts values($1,$2)',[initially,recipient]);assert.equal(await sender(),alternate,'Role claimed sender excluded');
 await thread(initially);assert.equal(await sender(),null,'Role conflict cannot rotate established SMS');
 for(const reviewed of [false,true]){
  await reset();await q('insert into icash_sms_routes values($1,$2,$3,$4)',[initially,recipient,reviewed?account:other,reviewed]);assert.equal(await sender(),alternate,'Foreign/reviewed route excluded');
  await recorded(initially);assert.equal(await sender(),null,'Established foreign/reviewed route holds');
 }
 await reset();await thread(initially,other,otherDeal);assert.equal(await sender(),alternate,'Foreign active SMS cannot be reused');
 await q('update icash_text_threads set retired_at=now()');assert.equal(await sender(),alternate,'Foreign historical SMS pair stays owned');
 await reset();await recorded(initially,'needs_review',other,otherScreen);assert.equal(await sender(),alternate,'Foreign uncertain AI call pair stays owned');
 await reset();await customer(initially,'needs_review',other,otherScreen);assert.equal(await sender(),alternate,'Foreign uncertain manual pair stays owned');
 await reset();await q('update icash_deal_files set account_id=$1 where id=$2',[account,otherDeal]);await thread(initially,account,otherDeal);assert.equal(await sender(),alternate,'New route avoids another active property');
 await q('update icash_deal_files set account_id=$1 where id=$2',[other,otherDeal]);

 // Run the actual snapshotted AI admission body with local spending/provider
 // prerequisites; its existing input, seller-only and Pause checks stay intact.
 await reset();
 const rate='00000000-0000-4000-8000-000000000010',job='00000000-0000-4000-8000-000000000011',target='00000000-0000-4000-8000-000000000012',operation='voice:'+job;
 await db.exec('insert into icash_operating_budget values(1,true,2,2)');
 await q('insert into icash_operation_rates(id,operation,charge_cents,costs_micros,enabled,expires_at,verified_at,voice_max_duration_seconds) values($1,\'seller_call\',977,\'{"twilio":100000}\',true,now()+interval \'1 day\',now(),600)',[rate]);
 await q('insert into icash_voice_configs values($1,\'agent_fixture\',true,now()+interval \'1 day\',600,$2,null)',[account,rate]);
 await q('insert into icash_voice_contact_targets values($1,$2,$3,\'seller\',$4,\'fixture\',null,now()+interval \'1 day\',true)',[target,account,screen,recipient]);
 await q('insert into icash_voice_jobs values($1,$2,$3,$4,null,\'dispatching\',null,null)',[job,account,operation,target]);
 await q('insert into icash_operation_spend values($1,$2,$3,\'dispatched\',now()+interval \'1 day\',null,977)',[account,operation,rate]);
 const policy={version:'required-audio-30d-speech-v1',retentionDays:30,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,recordingAllowanceMicros:31000,speechGatherMicros:20000,estimate:true};
 const admit=async from=>(await one('select icash_create_direct_recorded_call($1,$2,$3,null,$4,$5,$6,$7,$8) result',[account,operation,'AC'+'a'.repeat(32),'a'.repeat(64),'b'.repeat(64),'fixture-disclosure',JSON.stringify(policy),JSON.stringify({fromPhone:from,branchId:'agtbrch_fixture',versionId:'agtvrsn_fixture',maxTotalSeconds:600})])).result;
 assert.equal(await admit(alternate),null,'Admission rejects stale mismatched sender before recording a call');
 await thread(alternate);assert.equal(await admit(initially),null,'SMS arriving after preview pins final AI admission');
 let admitted=await admit(alternate);assert.equal(admitted.from_phone,alternate);assert.equal(await sms(),alternate);
 await q('update icash_text_senders set enabled=false where phone=$1',[alternate]);assert.equal((await admit(alternate)).id,admitted.id,'Existing operation retry preserves original receipt after disable');
 await reset();await q('update icash_accounts set bot_paused=true where id=$1',[account]);assert.equal(await admit(initially),null,'Pause still blocks new AI admission');
 await reset();await q('update icash_voice_contact_targets set party=\'buyer\'');assert.equal(await admit(initially),null,'Buyer AI admission remains blocked');await q('update icash_voice_contact_targets set party=\'seller\'');
 await q('update icash_text_senders set enabled=false where phone=$1',[initially]);assert.equal(await admit(initially),null,'Pool change after preview holds stale selection');

 // The actual browser/manual admission also rechecks the same sender and leaves
 // its original idempotent return ahead of newly added routing work.
 await reset();const manualId='00000000-0000-4000-8000-000000000020',callback='+12025550102';
 const manualAdmit=async from=>(await one('select icash_begin_customer_phone_call($1,$1,$2,$3,$4,$5,$6,$7,$8,$9) result',[account,screen,recipient,callback,manualId,from,'AC'+'a'.repeat(32),'c'.repeat(64),JSON.stringify({currency:'USD',country:'US',from,callback,recipient,checkedAt:new Date().toISOString(),receiptHash:'d'.repeat(64),callbackMicrosPerMinute:4000,recipientMicrosPerMinute:4000})])).result;
 assert((await manualAdmit(alternate)).error,'Manual final admission rejects a stale sender');
 const saved=await manualAdmit(initially);assert.equal(saved.call.business_phone,initially);assert.equal(await sms(),initially,'Manual first then SMS stays on saved business phone');
 await q('update icash_text_senders set enabled=false where phone=$1',[initially]);assert.equal((await manualAdmit(alternate)).call.id,saved.call.id,'Manual idempotency returns saved call without rotating');

 for(const fn of ['icash_business_conversation_sender','icash_property_call_sender','icash_property_text_sender','icash_customer_call_sender']){
  for(const role of ['anon','authenticated'])assert.equal((await one('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,fn+'(uuid,uuid,text)'])).allowed,false);
 }
 const definitions=(await q("select proname,provolatile,pg_get_functiondef(oid) definition from pg_proc where proname in ('icash_business_conversation_sender','icash_property_call_sender','icash_property_text_sender','icash_create_direct_recorded_call','icash_begin_customer_phone_call','icash_project_operational_sms_contacts')")).rows;
 for(const name of ['icash_business_conversation_sender','icash_property_call_sender']){const f=definitions.find(r=>r.proname===name);assert.equal(f.provolatile,'s');assert(!/pg_advisory|for update|for share|insert into|update public|delete from/i.test(f.definition));}
 assert.equal(definitions.find(r=>r.proname==='icash_property_text_sender').provolatile,'v');
 const operational=definitions.find(r=>r.proname==='icash_project_operational_sms_contacts').definition;
 assert(operational.includes('icash_business_conversation_sender(oc.account_id,oc.screening_id,oc.phone)'));assert(operational.includes('icash_business_conversation_sender(c.account_id,c.screening_id,c.phone)'));assert(!operational.includes('icash_property_text_sender('));
 for(const name of ['icash_property_text_sender','icash_create_direct_recorded_call','icash_begin_customer_phone_call','icash_project_operational_sms_contacts'])assert(definitions.find(r=>r.proname===name).definition.includes('pg_advisory_xact_lock(818,1)'),name+' admission lock');
 const aiDefinition=definitions.find(r=>r.proname==='icash_create_direct_recorded_call').definition;
 assert(aiDefinition.indexOf('return to_jsonb(r);')<aiDefinition.indexOf('from public.icash_operating_budget'),'Existing AI operation returns without new admission locks');
 assert(aiDefinition.indexOf('from public.icash_operating_budget')<aiDefinition.indexOf('pg_advisory_xact_lock(818,1)'),'AI budget lock precedes shared routing lock');
 assert(aiDefinition.indexOf('pg_advisory_xact_lock(818,1)')<aiDefinition.indexOf('select j.id as job_id'),'Routing lock precedes fresh bound-contact read');
 assert(aiDefinition.indexOf('icash_property_call_sender')<aiDefinition.indexOf('insert into public.icash_call_recordings'),'Fresh caller check precedes recording admission');
 for(const table of ['icash_call_recordings','icash_customer_phone_calls'])assert((await one('select count(*) n from pg_indexes where tablename=$1 and indexname in (\'icash_recording_business_recipient\',\'icash_customer_call_business_recipient\')',[table])).n>0,'Recipient history index '+table);
 console.log('PASS balanced routing:',mix.map(r=>`${r.sender}: ${r.count}/1000`).join(', '),'; shared pre-draft hash, SMS/call continuity, unknown outcomes, disabled holds, account/role conflicts, opt-outs, Pause, actual final AI/manual admission, private read-only selectors.');
}catch(error){console.error(error.message);if(error.where)console.error(error.where);if(error.stack?.includes('AssertionError'))console.error(error.stack);process.exitCode=1;}finally{await db.close();}
