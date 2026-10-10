// Isolated SQL integration. No auth mail, discovery, SMS, voice or email provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {databaseAdapter} from '../tests/helpers/simulated-journey-services.mjs';
import {networkConsentText,networkConsentVersion} from '../lib/buyer-network.ts';
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('NETWORK BLOCKED: local buyer-network fixture');};
assert(process.argv[2]?.startsWith('/'),'Pass an installed PGlite module path');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const {q,rpc}=databaseAdapter(pg),one=async(s,a=[])=>(await q(s,a)).rows[0];
const id=()=>randomUUID(),owner=id(),otherOwner=id(),buyerUser=id(),account=id(),other=id(),screen=id(),deal=id(),envelope=id(),rate=id();
let checks=0;const checked=()=>checks++;
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
 create table icash_memberships(account_id uuid,mode text,state text,paid_through timestamptz,vip_until timestamptz);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb,updated_at timestamptz default now());
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean default false);
 create table icash_disposition_authorities(deal_id uuid primary key,account_id uuid,purchase_envelope_id uuid,expires_at timestamptz,property_type text,asking_price_cents bigint,repairs_cents bigint);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table icash_buyer_package_links(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,purchase_envelope_id uuid,revoked_at timestamptz,asking_price_cents bigint,token text default replace(gen_random_uuid()::text,'-',''));
 create table icash_email_suppressions(account_id uuid,email text,reason text,primary key(account_id,email));
 create table icash_operation_rates(id uuid primary key,operation text,verified_at timestamptz,expires_at timestamptz,enabled boolean);
 create table icash_operating_budget(id integer primary key);insert into icash_operating_budget values(1);
 create table icash_customer_identities(account_id uuid,principal text);
 create table icash_fulfillment_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,state text,updated_at timestamptz default now(),result jsonb default '{}');
 create table fixture_controls(held boolean default false,reserved boolean default false,package_valid boolean default true,spend_allowed boolean default true,claims integer default 0);
 insert into fixture_controls default values;
 create function icash_vip_active(p_account uuid) returns boolean language sql stable set search_path='' as $$ select exists(select 1 from public.icash_memberships where account_id=p_account and mode='live' and state='active' and paid_through>now() and vip_until>now());$$;
 create function icash_buyer_outreach_held(uuid,uuid) returns boolean language sql stable as $$select held from public.fixture_controls$$;
 create function icash_buyer_is_reserved(uuid,uuid) returns boolean language sql stable as $$select reserved from public.fixture_controls$$;
 create function icash_buyer_package_data(uuid,uuid) returns jsonb language sql stable as $$select case when package_valid then '{"purchasePriceCents":9000000,"assignmentFeeCents":1000000}'::jsonb end from public.fixture_controls$$;
 create function icash_buyer_outreach_content(uuid,uuid) returns jsonb language sql stable as $$select '{"subject":"Off-market opportunity","email":"Still buying? View this $100,000 property package: https://homeoffernetwork.com/d/fixture"}'::jsonb$$;
 create function icash_deal_email_contacts(uuid,uuid) returns table(contact_key text,email text,display_name text,party text,verified_until timestamptz) language sql as $$select null::text,null::text,null::text,null::text,null::timestamptz where false$$;
 create function icash_queue_fulfillment() returns void language sql as $$select null::void$$;
 create function icash_reserve_operation(uuid,text,uuid,timestamptz) returns void language sql as $$select null::void$$;
 create function icash_claim_operation(text) returns boolean language plpgsql as $$begin update public.fixture_controls set claims=claims+1;return (select spend_allowed from public.fixture_controls);end$$;
 `);
 // Run the real existing email table and queue/claim implementations at the integration boundary.
 const mail=readFileSync('config/manual-deal-email.sql','utf8');
 await pg.exec(mail.match(/create table public\.icash_deal_emails\([\s\S]+?\n\);/)[0]);
 for(const name of ['icash_queue_deal_email','icash_claim_deal_email'])await pg.exec(mail.match(new RegExp(`create function public\\.${name}\\([\\s\\S]+?\nend \\$\\$;`))[0]);
 await pg.exec(readFileSync('supabase/migrations/20261010234658_platform_buyer_network.sql','utf8'));
 await q("insert into auth.users values($1,'seller@example.invalid',now()),($2,'other@example.invalid',now()),($3,'buyer@example.invalid',now())",[owner,otherOwner,buyerUser]);
 await q('insert into icash_accounts values($1,$2,false),($3,$4,false)',[account,owner,other,otherOwner]);
 await q("insert into icash_memberships values($1,'live','active',now()+interval '1 day',now()+interval '1 day'),($2,'live','active',now()+interval '1 day',now()+interval '1 day')",[account,other]);
 await q('insert into icash_screening_jobs values($1,$2,$3)',[screen,account,{propertyId:'prop_fixture',raw:{data:{zip:'75201'}}}]);
 await q("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$3,'under_contract',$4)",[deal,account,screen,{address:'123 Fixture St, Dallas TX 75201',priceCents:9000000,assignmentFeeCents:1000000}]);
 await q("insert into icash_signing_envelopes values($1,$2,$3,'purchase','completed',false)",[envelope,account,deal]);
 await q("insert into icash_disposition_authorities values($1,$2,$3,now()+interval '1 day','house',10000000,2000000)",[deal,account,envelope]);
 await q('insert into icash_buyer_package_links(account_id,deal_id,purchase_envelope_id,asking_price_cents) values($1,$2,$3,10000000)',[account,deal,envelope]);
 await q("insert into icash_operation_rates values($1,'manual_email',now()-interval '1 minute',now()+interval '1 day',true)",[rate]);
 await q("insert into icash_customer_identities values($1,'Fixture Deal Company')",[account]);
 await q("insert into icash_fulfillment_jobs(account_id,deal_id,state) values($1,$2,'complete')",[account,deal]);
 const profile={name:'Fixture Buyer',zips:['75201'],propertyTypes:['house'],maxPriceCents:15000000,maxRepairsCents:3000000,dailyEmails:1,accepted:true,consentVersion:networkConsentVersion};
 assert.equal(await rpc('icash_network_consent_text'),networkConsentText);
 const buyer=await rpc('icash_network_save_buyer',{p_user:buyerUser,p_profile:profile});
 assert.equal((await one('select state from icash_fulfillment_jobs')).state,'ready');checked();
 assert.equal((await rpc('icash_network_profile',{p_user:buyerUser})).email,'buyer@example.invalid');
 assert.equal(await rpc('icash_network_profile',{p_user:owner}),null);checked();
 const isolated=async(fn)=>{await q('begin');try{await fn();}finally{await q('rollback');}};
 for(const [sql,args] of [
  ['update auth.users set email_confirmed_at=null where id=$1',[buyerUser]],
  ['update auth.users set email=$2 where id=$1',[buyerUser,'changed@example.invalid']],
  ['update icash_network_buyers set paused=true',[]],
  ["update icash_network_buyers set expires_at=now()-interval '1 second'",[]],
  ["update icash_network_buyers set zips=array['75202']",[]],
  ["update icash_network_buyers set property_types=array['land']",[]],
  ['update icash_network_buyers set max_price_cents=9999999',[]],
  ['update icash_network_buyers set max_repairs_cents=1999999',[]],
  ["update icash_memberships set vip_until=now()-interval '1 second'",[]],
  ["update icash_memberships set mode='test'",[]],
  ['update icash_accounts set bot_paused=true',[]],
  ["update icash_signing_envelopes set state='awaiting_counterparty'",[]],
  ['update icash_signing_envelopes set test_mode=true',[]],
  ["update icash_deal_files set stage='closed'",[]],
  ["update icash_disposition_authorities set expires_at=now()-interval '1 second'",[]],
  ['update icash_buyer_package_links set revoked_at=now()',[]],
  ["insert into icash_property_controls values($1,'prop_fixture',true)",[account]],
  ['update fixture_controls set held=true',[]],['update fixture_controls set reserved=true',[]],['update fixture_controls set package_valid=false',[]],
  ["insert into icash_email_suppressions values($1,'buyer@example.invalid','complained')",[other]],
 ])await isolated(async()=>{await q(sql,args);assert.equal(await rpc('icash_network_match_deal',{p_account:account,p_deal:deal}),0,sql);checked();});
 assert.equal(await rpc('icash_network_match_deal',{p_account:other,p_deal:deal}),0);checked();
 assert.equal(await rpc('icash_network_match_deal',{p_account:account,p_deal:deal}),1);
 assert.equal(await rpc('icash_network_match_deal',{p_account:account,p_deal:deal}),0);checked();
 const match=(await one('select id from icash_network_matches')).id;
 const inbox=await rpc('icash_network_inbox',{p_user:buyerUser});assert.equal(inbox.length,1);
 assert.deepEqual(Object.keys(inbox[0]).sort(),['address','askingPriceCents','createdAt','id','state','url']);
 assert(!JSON.stringify(inbox).includes('9000000'));assert(!JSON.stringify(inbox).includes('assignmentFee'));assert.match(inbox[0].url,/^https:\/\/homeoffernetwork.com\/d\//);checked();
 assert.deepEqual(await rpc('icash_network_inbox',{p_user:owner}),[]);
 await assert.rejects(()=>rpc('icash_network_respond',{p_user:owner,p_match:match,p_state:'interested'}));checked();
 assert.equal(await rpc('icash_network_queue_email',{p_account:account,p_match:match}),null,'No sending without sender address');
 await assert.rejects(()=>rpc('icash_network_save_settings',{p_account:account,p_user:otherOwner,p_enabled:true,p_address:'123 Fixture Ave, Dallas TX 75201'}));checked();
 await rpc('icash_network_save_settings',{p_account:account,p_user:owner,p_enabled:true,p_address:'Fixture Company, 123 Fixture Ave, Dallas TX 75201'});
 const email=await rpc('icash_network_queue_email',{p_account:account,p_match:match});assert(email);
 assert.equal(await rpc('icash_network_queue_email',{p_account:account,p_match:match}),email,'One package per match');checked();
 const message=await one('select * from icash_deal_emails where id=$1',[email]);assert.match(message.body_text,/Stop network emails:/);assert(!message.body_text.includes('9000000'));checked();
 const token=(await one('select unsubscribe_token from icash_network_buyers where id=$1',[buyer])).unsubscribe_token;
 await isolated(async()=>{await rpc('icash_network_pause',{p_user:null,p_token:token});assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:email}),null);assert.deepEqual(await rpc('icash_network_inbox',{p_user:buyerUser}),[]);checked();});
 await isolated(async()=>{await q("insert into icash_email_suppressions values($1,'buyer@example.invalid','bounced')",[other]);assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:email}),null);checked();});
 await isolated(async()=>{await q('update icash_network_settings set enabled=false');assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:email}),null);checked();});
 await isolated(async()=>{await q("update icash_memberships set vip_until=now()-interval '1 second'");assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:email}),null);checked();});
 await isolated(async()=>{await q('update icash_deal_emails set body_text=$2 where id=$1',[email,'Acquisition price: $90,000; spread $10,000']);assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:email}),null);checked();});
 await isolated(async()=>{await q('update fixture_controls set spend_allowed=false');await assert.rejects(()=>rpc('icash_claim_deal_email',{p_account:account,p_id:email}),/spend or pause/);checked();});
 const claim=await rpc('icash_claim_deal_email',{p_account:account,p_id:email});assert.equal(claim.to,'buyer@example.invalid');assert.equal(claim.unsubscribeUrl,'https://homeoffernetwork.com/buyers/unsubscribe/'+token);
 assert.equal(await rpc('icash_claim_deal_email',{p_account:account,p_id:email}),null,'No repeat claim');checked();
 // A second account must not contact this buyer for the same property.
 const secondDeal=id(),secondScreen=id(),secondEnvelope=id();
 await q('insert into icash_screening_jobs select $1,$2,snapshot from icash_screening_jobs where id=$3',[secondScreen,other,screen]);
 await q('insert into icash_deal_files select $1,$2,$3,stage,terms,updated_at from icash_deal_files where id=$4',[secondDeal,other,secondScreen,deal]);
 await q("insert into icash_signing_envelopes values($1,$2,$3,'purchase','completed',false)",[secondEnvelope,other,secondDeal]);
 await q('insert into icash_disposition_authorities select $1,$2,$3,expires_at,property_type,asking_price_cents,repairs_cents from icash_disposition_authorities where deal_id=$4',[secondDeal,other,secondEnvelope,deal]);
 await q('insert into icash_buyer_package_links(account_id,deal_id,purchase_envelope_id,asking_price_cents) values($1,$2,$3,10000000)',[other,secondDeal,secondEnvelope]);
 await rpc('icash_network_save_settings',{p_account:other,p_user:otherOwner,p_enabled:true,p_address:'Other Company, 456 Fixture Ave, Dallas TX 75201'});
 assert.equal(await rpc('icash_network_match_deal',{p_account:other,p_deal:secondDeal}),0);checked();
 await q("update icash_deal_files set terms=jsonb_set(terms,'{address}','\"456 Fixture St, Dallas TX 75201\"') where id=$1",[secondDeal]);
 assert.equal(await rpc('icash_network_match_deal',{p_account:other,p_deal:secondDeal}),1);
 const secondMatch=(await one('select id from icash_network_matches where deal_id=$1',[secondDeal])).id;
 assert.equal(await rpc('icash_network_queue_email',{p_account:other,p_match:secondMatch}),null,'Daily email limit applies across accounts');checked();
 await rpc('icash_network_respond',{p_user:buyerUser,p_match:match,p_state:'interested'});
 const workspace=await rpc('icash_network_workspace',{p_account:account});assert.equal(workspace.responses,1);assert.equal(workspace.buyers[0].email,'buyer@example.invalid');
 assert.equal((await rpc('icash_network_workspace',{p_account:other})).responses,0);checked();
 await assert.rejects(()=>rpc('icash_network_ack_response',{p_account:other,p_user:otherOwner,p_match:match}));
 await rpc('icash_network_ack_response',{p_account:account,p_user:owner,p_match:match});assert.equal((await rpc('icash_network_workspace',{p_account:account})).responses,0);checked();
 await q("insert into icash_deal_emails(account_id,deal_id,direction,contact_key,recipient,subject,body_text,state,provider_id,reply_to_id) values($1,$2,'incoming',$3,'buyer@example.invalid','Reply','Can I view it Friday?','received',$4,$5)",[account,deal,'network:'+match,id(),email]);
 assert.equal((await rpc('icash_network_workspace',{p_account:account})).buyers[0].reply,'Can I view it Friday?');checked();
 await rpc('icash_network_respond',{p_user:buyerUser,p_match:match,p_state:'passed'});assert.equal(await rpc('icash_network_match_current',{p_match:match}),false);checked();
 // Grants and RLS deny direct network reads and forged RPCs to browser roles.
 const functions=(await q("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'icash_network_%'")).rows;
 for(const role of ['anon','authenticated']){
  for(const f of functions)assert.equal((await one('select has_function_privilege($1,$2,\'execute\') allowed',[role,f.signature])).allowed,false);
  for(const table of ['icash_network_buyers','icash_network_consents','icash_network_settings','icash_network_matches']){
   assert.equal((await one('select has_table_privilege($1,$2,\'select\') allowed',[role,table])).allowed,false);
   assert.equal((await one('select relrowsecurity enabled from pg_class where oid=$1::regclass',[table])).enabled,true);
  }
 }checked();
 console.log(`PASS ${checks} buyer-network SQL scenarios: enrollment, criteria, VIP, signed deals, privacy, consent, shared suppression, deduplication, daily limits, receipts, replies and tenant isolation. No provider calls.`);
}catch(error){console.error('FAIL buyer network:',error.message,error.where??'',error.stack?.split('\n').find(line=>line.includes('test-buyer-network-pglite'))??'');process.exitCode=1;}
finally{await pg.close();globalThis.fetch=originalFetch;}
