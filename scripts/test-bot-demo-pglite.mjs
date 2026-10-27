// In-memory PostgreSQL only. No provider requests, messages or calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {botDemoConsentText,botDemoConsentVersion,botDemoSubmission} from '../lib/bot-demo.ts';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
const table=name=>{const s=read('supabase/migrations/20261004170451_seller_intake_and_budgeted_lead_assignment.sql');const start=s.indexOf('create table public.'+name+' (');assert(start>=0);return s.slice(start,s.indexOf(';',start)+1);};
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',account='48dfb798-8c1a-404f-88c0-c396cc067062',other=randomUUID(),leadRequest=randomUUID();
const args=[owner,account,leadRequest,'a'.repeat(64),'Demo Seller','45 Fixture Lane, Dallas, TX 75201','+12145550123',true,'b'.repeat(64),'America/Chicago','c'.repeat(64)];
const submit=a=>one('select icash_submit_bot_demo_intake($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) id',a);
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false,daily_limit_cents bigint default 10000,created_at timestamptz default now());
 create table icash_wallets(account_id uuid,balance_cents bigint);
 create table icash_operating_budget(id integer);insert into icash_operating_budget values(1);
 create table icash_screening_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,event_key text,snapshot jsonb,state text,result jsonb,completed_at timestamptz);
 create table icash_operation_spend(operation_key text primary key,cost_basis text);
 create table icash_operation_rates(id uuid primary key default gen_random_uuid(),operation text,version text,charge_cents bigint,costs_micros jsonb,buffer_bps integer,evidence_ref text,verified_at timestamptz,expires_at timestamptz,enabled boolean);
 create table icash_text_suppressions(phone text);create table icash_contact_suppressions(account_id uuid,contact_key text);
 create table icash_live_conversations(account_id uuid,screening_id uuid,contact_key text);
 create table icash_deal_files(id uuid default gen_random_uuid(),account_id uuid,screening_id uuid,terms jsonb);
 create table icash_discovery_configs(account_id uuid primary key,enabled boolean,auto_enabled boolean,next_run_at timestamptz);
 create table icash_meta_leads(lead_id uuid primary key,account_id uuid,screening_id uuid,source_id uuid,meta_id text,routed_at timestamptz,next_attempt_at timestamptz);
 create table icash_meta_import_priorities(source_id uuid,meta_id text);
 create function icash_meta_pool_receipt_current(uuid) returns boolean language sql as $$select exists(select 1 from public.icash_meta_leads where lead_id=$1)$$;
 create function icash_outreach_sms_current(uuid) returns boolean language sql as $$select true$$;
 create function icash_outreach_voice_current(uuid) returns boolean language sql as $$select true$$;
 create table icash_signing_envelopes(account_id uuid,deal_id uuid,kind text,test_mode boolean,state text);
 create table icash_outbound_property_owners(property_id text,account_id uuid);
 create table icash_billing_reviews(account_id uuid,resolved_at timestamptz);
 create table icash_customer_identities(account_id uuid,principal text);
 create table icash_timezone_names(name text);insert into icash_timezone_names values('America/Chicago');
 create function icash_credit_acquisition_allowed(uuid) returns boolean language sql as $$select true$$;
 create function icash_daily_allowance(uuid) returns jsonb language sql as $$select '{"remainingCents":10000}'::jsonb$$;
 create function icash_vip_active(uuid) returns boolean language sql as $$select false$$;
 create function icash_hybrid_inbound_share(bigint) returns numeric language sql as $$select 1::numeric$$;
 create function icash_research_state_allowed(text) returns boolean language sql as $$select true$$;
 create function icash_seller_assignment_due(integer,timestamptz,timestamptz) returns timestamptz language sql as $$select now()$$;
 create function icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) returns void language sql as $$select$$;
 create function icash_claim_operation(text) returns boolean language sql as $$select true$$;
 create function icash_settle_complete_costs(text,bigint,jsonb,text) returns void language sql as $$insert into public.icash_operation_spend(operation_key) values($1)$$;
 `);
 await pg.exec(table('icash_seller_controls')+table('icash_seller_intakes')+table('icash_seller_matches')+table('icash_seller_events'));
 await pg.exec(`alter table icash_seller_controls add column limited_contact_enabled boolean default true;
 alter table icash_seller_intakes add column email text,add column email_consented boolean default false,add column customer_costs jsonb,add column customer_cost_basis text,add column contact_consent_scope text constraint icash_seller_intakes_contact_consent_scope_check check(contact_consent_scope is null or contact_consent_scope='homeoffer_network_and_matched_buyers');
 insert into icash_seller_controls(id,enabled,data_rights_until,review_ref) values(1,true,now()+interval '7 days','Fixture data-use review');`);
 await pg.exec(read('tests/fixtures/bot-demo-source.sql'));
 await pg.exec(read('config/bot-demo-intake.sql'));
 const lookupSource=read('config/seller-funnel-milestones.sql');
 await pg.exec(lookupSource.slice(lookupSource.indexOf('CREATE OR REPLACE FUNCTION public.icash_finish_seller_lookup'),lookupSource.indexOf('-- Backfill genuine recent submissions')));
 await pg.exec(read('config/demo-intake-resubmission.sql'));
 await pg.exec(read('config/demo-intake-resubmission.sql'));
 // Surface fixture adapter errors instead of the production retry outcome.
 const definition=(await one("select pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure) d")).d;
 await pg.exec(definition.replace('   null;','   raise;'));
 await q('insert into icash_accounts(id,owner_user_id) values($1,$2),($3,$4)',[account,owner,other,randomUUID()]);
 await q('insert into icash_wallets values($1,10000),($2,10000)',[account,other]);
 await q("insert into icash_customer_identities values($1,'iCash X'),($2,'Another account')",[account,other]);
 await q('insert into icash_discovery_configs values($1,true,true,now()),($2,true,true,now())',[account,other]);
 await pg.exec(read('tests/fixtures/owner-manual-demo-meta-assignment.sql'));
 await pg.exec('revoke all on function icash_meta_assign_contact(uuid) from public,anon,authenticated;grant execute on function icash_meta_assign_contact(uuid) to service_role;');
 const allocationPrivileges=await q("select oid::regprocedure::text name,proacl,prosecdef,proconfig from pg_proc where oid in ('icash_assign_seller_lead_for(uuid)'::regprocedure,'icash_meta_assign_contact(uuid)'::regprocedure) order by name");
 await pg.exec(read('config/owner-manual-demo-only.sql'));
 await pg.exec(read('config/owner-manual-demo-only.sql'));
 assert.deepEqual((await q("select oid::regprocedure::text name,proacl,prosecdef,proconfig from pg_proc where oid in ('icash_assign_seller_lead_for(uuid)'::regprocedure,'icash_meta_assign_contact(uuid)'::regprocedure) order by name")).rows,allocationPrivileges.rows,'private allocation permissions remain unchanged');
 assert.deepEqual(await one('select enabled,auto_enabled from icash_discovery_configs where account_id=$1',[account]),{enabled:false,auto_enabled:false});
 assert.deepEqual(await one('select enabled,auto_enabled from icash_discovery_configs where account_id=$1',[other]),{enabled:true,auto_enabled:true});
 const {id}=await submit(args);assert.equal((await submit(args)).id,id);
 const saved=await one('select * from icash_seller_intakes where id=$1',[id]);
 assert.equal(saved.consent_text,botDemoConsentText);assert.equal(saved.consent_version,botDemoConsentVersion);
 assert.equal(saved.contact_consent_scope,'icash_x_demo');assert.equal(saved.attribution.demoAccountId,account);assert.equal(saved.owner_claimed,false);
 await assert.rejects(submit([randomUUID(),...args.slice(1)]),/Presenting account/);
 await assert.rejects(submit(args.map((v,i)=>i===7?false:v)),/Valid demo consent/);
 await assert.rejects(submit(args.map((v,i)=>i===3?'d'.repeat(64):v)),/retry mismatch/);
 const duplicate=await submit(args.map((v,i)=>i===2?randomUUID():v));
 assert.equal((await one('select canonical_id from icash_seller_intakes where id=$1',[duplicate.id])).canonical_id,id);
 await q(`update icash_seller_intakes set state='qualified',numbers_passed=true,checked_at=now(),data_rights_until=now()+interval '7 days',property='{"id":"prop_demo","city":"Dallas","state":"TX"}',result='{}',lookup_costs='{"dealmachine":10000}',lookup_cost_basis='Fixture recorded research' where id=$1`,[id]);
 await q('update icash_accounts set bot_paused=true where id=$1',[account]);
 assert.equal((await one('select icash_assign_seller_lead_for($1) r',[id])).r,null,'paused presenter never routes to the other account');
 await q('update icash_accounts set bot_paused=false where id=$1',[account]);
 const assigned=(await one('select icash_assign_seller_lead_for($1) r',[id])).r;
 assert.equal(assigned.accountId,account);assert.equal(assigned.status,'assigned');
 assert.equal((await one('select icash_assign_seller_lead_for($1) r',[id])).r,null,'no second customer for a demo');
 const {screening_id}=await one('select screening_id from icash_seller_matches where lead_id=$1',[id]);
 const screen=await one('select snapshot from icash_screening_jobs where id=$1',[screening_id]);
 assert.equal(screen.snapshot.sellerRequest.maximumBuyers,1);assert.equal(screen.snapshot.sellerRequest.shared,false);
 assert((await one('select icash_seller_contact_evidence($1,$2,$3,$4) e',[account,screening_id,id,args[6]])).e,'truthful iCash consent projects contact evidence');
 assert.equal((await one('select icash_seller_contact_evidence($1,$2,$3,$4) e',[other,screening_id,id,args[6]])).e,null,'no cross-account contact evidence');
 // Full repeat: fresh receipt -> real lookup finalizer -> real assignment SQL.
 const finish=async(lead,propertyId='prop_demo')=>{
  const token=randomUUID(),output={creditsUsed:0,numbersPassed:true,status:'qualified',property:{id:propertyId,city:'Dallas',state:'TX'},result:{financialCheck:{status:'eligible'},preliminarySellerCeilingCents:8000000}};
  await q(`update icash_seller_intakes set state='checking',claim_token=$2,claimed_at=now(),lookup_cap_micros=0,lookup_costs='{"dealmachine":10000,"vercel":1000}',lookup_cost_basis='Fixture saved research',data_rights_until=now()+interval '7 days' where id=$1`,[lead,token]);
  assert.equal((await one('select icash_finish_seller_lookup($1,$2,$3) ok',[lead,token,output])).ok,true);
  assert.equal((await one('select icash_finish_seller_lookup($1,$2,$3) ok',[lead,token,output])).ok,false,'lookup receipt is consumed once');
  return one('select * from icash_seller_intakes where id=$1',[lead]);
 };
 const differentKey=await submit(args.map((v,i)=>i===2?randomUUID():i===8?'d'.repeat(64):v));
 assert.equal((await finish(differentKey.id)).canonical_id,id,'active run deduplicates even with a different submitted address key');
 const oldMatchCount=Number((await one('select count(*) n from icash_seller_matches where lead_id=$1',[id])).n);
 await q("update icash_screening_jobs set state='archived' where id=$1",[screening_id]);
 const freshArgs=args.map((v,i)=>i===2?randomUUID():v),fresh=await submit(freshArgs);
 assert.equal((await one('select state from icash_seller_intakes where id=$1',[fresh.id])).state,'received','same address and phone can start after archive');
 assert.equal((await submit(freshArgs)).id,fresh.id,'retry remains the same receipt');
 const checked=await finish(fresh.id);assert.equal(checked.state,'qualified');assert.equal(checked.canonical_id,null);assert.equal(checked.numbers_passed,true);
 assert.equal((await one('select icash_assign_seller_lead_for($1) r',[fresh.id])).r.accountId,account);
 const freshScreen=await one('select screening_id from icash_seller_matches where lead_id=$1',[fresh.id]);assert.notEqual(freshScreen.screening_id,screening_id);
 assert.equal((await one('select state from icash_screening_jobs where id=$1',[screening_id])).state,'archived','old run remains history');
 assert.equal(Number((await one('select count(*) n from icash_seller_matches where lead_id=$1',[id])).n),oldMatchCount);
 // Real consent predicate + the manual contact migration: archived revocations
 // must not block a new verified opt-in, while actual opt-outs still do.
 await pg.exec(`create schema extensions;
 create function extensions.digest(text,text) returns bytea language sql as $$select sha256(convert_to($1,'UTF8'))$$;
 create table icash_owner_contacts(account_id uuid,screening_id uuid,result jsonb);
 create table icash_text_threads(account_id uuid,deal_id uuid,recipient text);
 create table icash_contact_permissions(account_id uuid,screening_id uuid,phone text,revoked_at timestamptz);`);
 await pg.exec(read('supabase/migrations/20261015210959_consented_browser_calling.sql').split('-- Resolve the business caller ID')[0]);
 const currentScreen=freshScreen.screening_id,phone=args[6];
 await q('insert into icash_owner_contacts values($1,$2,$3)',[account,currentScreen,{contacts:[{name:'Demo Seller',phones:[{number:'(214) 555-0123',type:'mobile',doNotCall:true}]}]}]);
 await q('insert into icash_contact_permissions values($1,$2,$3,now())',[account,screening_id,phone]);
 const contact=()=>one('select * from icash_manual_contacts($1,$2)',[account,currentScreen]);
 // Exercise the real consent row locks under PostgREST's POST transaction rule:
 // STABLE/IMMUTABLE => READ ONLY; VOLATILE => READ WRITE.
 // https://docs.postgrest.org/en/stable/references/transactions.html#access-mode-on-functions
 await pg.exec(`alter table icash_text_threads add column id uuid,add column sender text,add column retired_at timestamptz,add column sms_rate_id uuid;
 create table icash_text_senders(phone text,enabled boolean);
 create table icash_text_messages(id uuid,thread_id uuid,account_id uuid,direction text,state text,created_at timestamptz);
 create table icash_manual_call_attempts(phone text,created_at timestamptz);
 create table icash_communication_prices(operation text,customer_micros bigint);
 alter table icash_wallets add column reserved_cents bigint default 0;
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;`);
 const contactSource=read('supabase/migrations/20261006001029_manual_property_contacts_and_texting.sql');
 await pg.exec(contactSource.slice(contactSource.indexOf('create or replace function public.icash_manual_contact_reason'),contactSource.indexOf('create or replace function public.icash_start_manual_call')));
 const senderSource=read('supabase/migrations/20261015210959_consented_browser_calling.sql');
 await pg.exec(senderSource.slice(senderSource.indexOf('-- Resolve the business caller ID'),senderSource.indexOf('-- Preserve the current pricing')));
 const textSource=read('supabase/migrations/20261008182808_available_credit_usage.sql');
 await pg.exec(textSource.slice(textSource.indexOf('CREATE OR REPLACE FUNCTION public.icash_manual_text_reason'),textSource.indexOf('CREATE OR REPLACE FUNCTION public.icash_next_work')));
 const thread=randomUUID(),rate=randomUUID(),sender='+12145550999';
 await q('insert into icash_deal_files values($1,$2,$3)',[thread,account,currentScreen]);
 await q('insert into icash_text_threads(account_id,deal_id,recipient,id,sender,sms_rate_id) values($1,$2,$3,$2,$4,$5)',[account,thread,phone,sender,rate]);
 await q('insert into icash_text_senders values($1,true)',[sender]);
 await q("insert into icash_operation_rates(id,operation,charge_cents,enabled,expires_at) values($1,'sms_send',1,true,now()+interval '1 day')",[rate]);
 await pg.exec("insert into icash_communication_prices values('sms_segment',10000)");
 const rpcCases=[
  {signature:'icash_manual_contacts(uuid,uuid)',sql:'select * from icash_manual_contacts($1,$2)',params:[account,currentScreen]},
  {signature:'icash_manual_contact_reason(uuid,uuid,text,text,uuid)',sql:"select icash_manual_contact_reason($1,$2,$3,'voice') result",params:[account,currentScreen,phone]},
  {signature:'icash_customer_call_sender(uuid,uuid,text)',sql:'select icash_customer_call_sender($1,$2,$3) result',params:[account,currentScreen,phone]},
  {signature:'icash_manual_text_reason(uuid,uuid,uuid)',sql:'select icash_manual_text_reason($1,$2) result',params:[account,thread]}
 ];
 for(const {signature} of rpcCases)await pg.exec(`revoke all on function ${signature} from public,anon,authenticated;grant execute on function ${signature} to service_role;`);
 const rpc=async({signature,sql,params})=>{
  const {provolatile}=await one('select provolatile from pg_proc where oid=$1::regprocedure',[signature]);
  await q(provolatile==='v'?'begin read write':'begin read only');
  try{return await q(sql,params);}finally{await q('rollback');}
 };
 for(const item of rpcCases)await assert.rejects(()=>rpc(item),e=>e.code==='25006'&&/SELECT FOR SHARE/.test(e.message),item.signature+' reproduces the live API failure');
 const before=new Map();
 for(const {signature} of rpcCases)before.set(signature,await one('select prosrc,proacl,prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature]));
 const transactionFix=read('supabase/migrations/20261015214113_contact_rpc_transaction_mode.sql');
 await pg.exec(transactionFix);await pg.exec(transactionFix);
 for(const {signature} of rpcCases){
  assert.deepEqual(await one('select prosrc,proacl,prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature]),before.get(signature),'function logic and access unchanged: '+signature);
  for(const role of ['anon','authenticated'])assert.equal((await one('select has_function_privilege($1,$2,\'execute\') allowed',[role,signature])).allowed,false);
 }
 assert.equal((await rpc(rpcCases[0])).rows[0].blocked,false);
 assert.equal((await rpc(rpcCases[1])).rows[0].result,null);
 assert.equal((await rpc(rpcCases[2])).rows[0].result,sender);
 assert.equal((await rpc(rpcCases[3])).rows[0].result,null);
 assert.equal((await one('select count(*)::int n from icash_manual_call_attempts')).n,0,'contact reads never create calls');
 assert.equal((await one('select count(*)::int n from icash_text_messages')).n,0,'contact reads never send texts');
 console.log('PASS: reproduced SQLSTATE 25006 for all four RPCs; POST transaction mode now permits unchanged consent locks and private call/text reads.');
 assert.equal((await contact()).blocked,false,'current verified consent overrides source DNC and archived demo revocation');
 assert.equal((await contact()).phone,phone,'formatted source numbers normalize and deduplicate');
 assert.equal((await q('select * from icash_manual_contacts($1,$2)',[other,currentScreen])).rows.length,0,'no cross-account contact access');
 assert.equal((await q('select * from icash_manual_contacts($1,$2)',[account,screening_id])).rows.length,0,'archived property stays unavailable');
 const held=[
  ["insert into icash_text_suppressions values($1)",[phone],'SMS STOP'],
  ["insert into icash_contact_suppressions values($1,encode(sha256(convert_to($2,'UTF8')),'hex'))",[account,phone],'voice opt-out'],
  ["insert into icash_contact_permissions values($1,$2,$3,now())",[account,currentScreen,phone],'current property revocation'],
  ["update icash_screening_jobs set state='complete' where id=$1",[screening_id],'revocation on another active property'],
  ["update icash_seller_intakes set ai_consented=false where id=$1",[fresh.id],'consent withdrawn'],
  ["update icash_seller_intakes set consent_text='mismatch' where id=$1",[fresh.id],'consent statement mismatch'],
  ["update icash_seller_intakes set data_rights_until=now()-interval '1 minute' where id=$1",[fresh.id],'expired consent'],
  ["update icash_seller_intakes set attribution='{}' where id=$1",[fresh.id],'wrong account binding']
 ];
 for(const [sql,params,label] of held){await q('begin');try{await q(sql,params);assert.equal((await contact()).blocked,true,label);}finally{await q('rollback');}}
 assert.equal((await one('select count(*)::int n from icash_contact_permissions where revoked_at is not null')).n,1,'archived history remains revoked');
 assert.equal((await one("select result->'contacts'->0->'phones'->0->>'doNotCall' flag from icash_owner_contacts")).flag,'true','source evidence is never rewritten');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'public.icash_manual_contacts(uuid,uuid)','execute') allowed",[role])).allowed,false);
 console.log('PASS: consent-aware manual calling, source DNC, archived revocations, STOP, current revocation, expiry and exact account binding.');
 const again=await submit(args.map((v,i)=>i===2?randomUUID():v));assert.equal((await one('select canonical_id from icash_seller_intakes where id=$1',[again.id])).canonical_id,fresh.id);
 const otherOwner=(await one('select owner_user_id from icash_accounts where id=$1',[other])).owner_user_id;
 const otherDemo=await submit(args.map((v,i)=>i===0?otherOwner:i===1?other:i===2?randomUUID():v));
 assert.equal((await finish(otherDemo.id)).state,'qualified','a different demo account has its own property test');
 // Public submissions are never swallowed by private demo history. Public
 // property deduplication still prevents duplicate distribution among sellers.
 const network=await submit(args.map((v,i)=>i===2?randomUUID():i===8?'e'.repeat(64):v));
 await q("update icash_seller_intakes set contact_consent_scope='homeoffer_network_and_matched_buyers' where id=$1",[network.id]);
 assert.equal((await finish(network.id)).state,'qualified','private demos cannot block a real seller request');
 const networkRepeat=await submit(args.map((v,i)=>i===2?randomUUID():i===8?'f'.repeat(64):v));
 await q("update icash_seller_intakes set contact_consent_scope='homeoffer_network_and_matched_buyers' where id=$1",[networkRepeat.id]);
 assert.equal((await finish(networkRepeat.id)).canonical_id,network.id,'real seller duplicates still share one canonical lead');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'public.icash_demo_intake_current(uuid,uuid)','execute') allowed",[role])).allowed,false);
 await q("update icash_seller_intakes set consent_text='Different consent' where id=$1",[id]);
 assert.equal((await one('select icash_seller_contact_evidence($1,$2,$3,$4) e',[account,screening_id,id,args[6]])).e,null,'exact consent is required');
 // Existing network requests retain their separate routing policy.
 await q("update icash_seller_intakes set contact_consent_scope='homeoffer_network_and_matched_buyers' where id=$1",[id]);
 assert.equal((await one('select icash_assign_seller_lead_for($1) r',[id])).r.accountId,other);
 // Funded, running owner still accepts only its explicit private input.
 const ownerScreens=(await one('select count(*)::int n from icash_screening_jobs where account_id=$1',[account])).n;
 await q('update icash_accounts set bot_paused=true where id=$1',[other]);
 assert.equal((await one('select icash_assign_seller_lead_for($1) r',[network.id])).r,null,'public seller cannot be assigned to the owner when other customers are paused');
 await q('insert into icash_meta_leads(lead_id,source_id,meta_id) values($1,$2,$3)',[network.id,randomUUID(),'fixture-meta-owner-isolation']);
 assert.equal((await one('select icash_meta_assign_contact($1) r',[network.id])).r.status,'waiting_for_funded_buyer','Meta pool excludes funded owner');
 assert.equal((await one('select count(*)::int n from icash_screening_jobs where account_id=$1',[account])).n,ownerScreens);
 await q('update icash_accounts set bot_paused=false where id=$1',[other]);
 assert.equal((await one('select icash_meta_assign_contact($1) r',[network.id])).r.accountId,other,'ordinary customer still receives Meta lead');
 assert.equal((await one('select icash_meta_assign_contact($1) r',[network.id])).r.accountId,other,'existing Meta assignment stays idempotent');
 assert.equal((await one('select icash_assign_seller_lead_for($1) r',[network.id])).r.accountId,other,'ordinary seller assignment remains available');
 assert.equal((await one('select count(*)::int n from icash_screening_jobs where account_id=$1',[account])).n,ownerScreens,'no automatic owner leads');
 console.log('PASS: owner discovery disabled, private submitted leads work, shared seller and Meta leads excluded, customer routing preserved, unchanged service-only access.');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'public.icash_submit_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text)','execute') allowed",[role])).allowed,false);
 const input={name:'Demo Seller',address:'45 Fixture Lane',phone:'2145550123',consented:true,consentVersion:botDemoConsentVersion,requestId:leadRequest};
 assert(botDemoSubmission.safeParse(input).success);assert(!botDemoSubmission.safeParse({...input,accountId:other}).success);assert(!botDemoSubmission.safeParse({...input,consented:false}).success);
 console.log('PASS: consent, ownership, retries, active duplicates, archived resubmission through lookup and assignment, account/source isolation, original network routing, and service-only permissions. No paid work.');
}catch(error){console.error({message:error.message,detail:error.detail,where:error.where,position:error.position,stack:error.stack?.split('\n').slice(0,4)});process.exitCode=1;}finally{await pg.close();}
