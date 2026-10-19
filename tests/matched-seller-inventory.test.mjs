// Local database fixtures only: no provider calls or customer data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const phone='+12125550191',a=id(1),b=id(2),stranger=id(3),lead=id(4),sa=id(5),sb=id(6),sc=id(7),sms=id(8),call=id(9),rateSms=id(10),rateCall=id(11);
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create schema extensions;create function extensions.digest(text,text) returns bytea language sql as $$select sha256(convert_to($1,'UTF8'))$$;
 create table icash_operating_budget(id integer);insert into icash_operating_budget values(1);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb);
 create table icash_seller_intakes(id uuid primary key,state text,phone text,property jsonb,ai_consented boolean,consent_version text,consent_text text,contact_consent_scope text,created_at timestamptz,data_rights_until timestamptz,attribution jsonb);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid,primary key(lead_id,account_id));
 create table icash_customer_identities(account_id uuid,principal text);
 create table icash_timezone_names(name text);insert into icash_timezone_names values('America/Chicago');
 create table icash_inventory_claims(resource_key text primary key,account_id uuid,screening_id uuid,cooldown_until timestamptz,updated_at timestamptz default now());
 create table icash_outbound_property_owners(property_id text,account_id uuid);
 create table icash_text_suppressions(phone text);create table icash_contact_suppressions(contact_key text);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text);
 create table icash_live_callbacks(account_id uuid,screening_id uuid,state text);
 create table icash_live_conversations(account_id uuid,screening_id uuid,state text);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table icash_handoffs(account_id uuid,screening_id uuid,state text);
 create table icash_signing_envelopes(account_id uuid,deal_id uuid,kind text,test_mode boolean,state text);
 create table icash_operation_rates(id uuid,operation text);
 create table icash_text_threads(id uuid,account_id uuid,deal_id uuid,recipient text,party text);
 create table icash_text_messages(id uuid,account_id uuid,thread_id uuid);
 create table icash_contact_permissions(id uuid,account_id uuid,screening_id uuid,phone text,party text);
 create table icash_voice_jobs(id uuid,account_id uuid,permission_id uuid);
 create table fixture_reservations(operation text primary key,account_id uuid);
 create function icash_meta_contact_only(uuid,uuid,text) returns boolean language sql as $$select false$$;
 create function icash_reserve_before_inventory(uuid,text,uuid,timestamptz,timestamptz,boolean) returns jsonb language plpgsql as $$begin insert into public.fixture_reservations values($2,$1) on conflict do nothing;return jsonb_build_object('operationKey',$2);end$$;`);
 // Use the actual website source/phone/consent evidence checks, not a true stub.
 const contacts=read('config/seller-intake-contacts.sql');
 await pg.exec(contacts.slice(contacts.indexOf('create function public.icash_seller_contact_evidence'),contacts.indexOf('create function public.icash_seller_voice_permission_current')));
 await pg.exec(read('tests/fixtures/matched-seller-inventory-upstream.sql'));
 const consent='I agree to marketing calls, texts and emails about my property from HomeOffer Network and its matched buyers, including automated texts and AI-generated voice calls. Consent is not a condition of buying or selling. Message/data rates may apply. Reply STOP to texts or unsubscribe from emails.';
 await q("insert into icash_seller_intakes values($1,'assigned',$2,'{\"id\":\"prop_fixture\"}',true,'homeoffer-seller-contact-2026-10-05.4',$3,'homeoffer_network_and_matched_buyers',now()-interval '25 hours',now()+interval '7 days','{\"contactTimezone\":\"America/Chicago\",\"contactTimezoneSource\":\"seller_browser\"}')",[lead,phone,consent]);
 for(const [account,screen] of [[a,sa],[b,sb],[stranger,sc]]){
  await q("insert into icash_screening_jobs values($1,$2,'complete',$3)",[screen,account,{propertyId:'prop_fixture',sellerRequest:{id:lead,phone}}]);
  await q("insert into icash_customer_identities values($1,'Fixture Buyer')",[account]);
  await q("insert into icash_deal_files values($1,$2,$3,'draft')",[screen,account,screen]);
 }
 for(const [account,screen] of [[a,sa],[b,sb]])await q('insert into icash_seller_matches values($1,$2,$3)',[lead,account,screen]);
 await q("insert into icash_inventory_claims values('property:prop_fixture',$1,$2,now()+interval '30 days',now())",[a,sa]);
 await q("insert into icash_text_threads values($1,$2,$3,$4,'seller')",[sms,b,sb,phone]);
 await q('insert into icash_text_messages values($1,$2,$1)',[sms,b]);
 await q("insert into icash_contact_permissions values($1,$2,$3,$4,'seller')",[call,b,sb,phone]);
 await q('insert into icash_voice_jobs values($1,$2,$1)',[call,b]);
 await q("insert into icash_operation_rates values($1,'sms_send'),($2,'seller_call')",[rateSms,rateCall]);
 const claim=(account=b,screen=sb,recipient=phone)=>one('select icash_claim_inventory($1,$2,$3)',[account,screen,recipient]);
 const reserve=(operation,rate)=>one("select icash_reserve_before_activation($1,$2,$3,now()+interval '1 day',now(),true)",[b,operation,rate]);
 const oldClaim=await one('select to_jsonb(c) from icash_inventory_claims c');
 assert.equal(await claim(),false,'reproduce second matched buyer blocked by exclusive cold inventory');
 await assert.rejects(()=>reserve('text:'+sms,rateSms),/Seller inventory assigned or suppressed/);
 await assert.rejects(()=>reserve('voice:'+call,rateCall),/Seller inventory assigned or suppressed/);
 const migration=read('config/matched-seller-inventory-dispatch.sql');
 assert.equal(migration,read('supabase/migrations/20261019021025_matched_seller_inventory_dispatch.sql'));
 await pg.exec(migration);
 assert.equal(await claim(a,sa),true);assert.equal(await claim(),true);
 assert.deepEqual(await reserve('text:'+sms,rateSms),{operationKey:'text:'+sms});
 assert.deepEqual(await reserve('voice:'+call,rateCall),{operationKey:'voice:'+call});
 await reserve('text:'+sms,rateSms);await reserve('voice:'+call,rateCall);
 assert.equal(await one('select count(*)::int from fixture_reservations'),2,'existing operation identities stay idempotent');
 assert.deepEqual(await one('select to_jsonb(c) from icash_inventory_claims c'),oldClaim,'shared contact never transfers the cold claim');
 assert.equal(await claim(stranger,sc),false,'a copied sellerRequest cannot create an assignment');
 assert.equal(await claim(b,sa),false,'cross-account screening is rejected');
 assert.equal(await claim(b,sb,'+12125550192'),false,'only the submitted phone is permitted');
 assert.equal(await claim(b,sb,null),false,'a shared match cannot be used for cold enrichment');
 const isolated=async(fn)=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
 for(const mutation of [
  "update icash_seller_intakes set ai_consented=false",
  "update icash_seller_intakes set consent_text='different source evidence'",
  "update icash_seller_intakes set data_rights_until=now()-interval '1 second'",
  "update icash_seller_intakes set created_at=now()-interval '31 days'",
  "update icash_seller_intakes set state='review'",
  "update icash_seller_intakes set property='{\"id\":\"prop_different\"}'",
  "update icash_screening_jobs set snapshot=snapshot-'sellerRequest'",
  "update icash_screening_jobs set state='awaiting_address'",
  "update icash_customer_identities set principal=''",
  `insert into icash_text_suppressions values('${phone}')`,
  `insert into icash_contact_suppressions values(encode(sha256(convert_to('${phone}','UTF8')),'hex'))`,
  `insert into icash_property_controls values('${b}','prop_fixture',true)`,
  `insert into icash_handoffs values('${b}','${sb}','waiting')`,
  `insert into icash_outbound_property_owners values('prop_fixture','${a}')`,
  `insert into icash_signing_envelopes values('${a}','${sa}','purchase',false,'completed')`,
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await claim(),false,mutation);await assert.rejects(()=>reserve('text:'+sms,rateSms),/Seller inventory assigned or suppressed/);});
 await isolated(async()=>{
  await q("insert into icash_signing_envelopes values($1,$2,'purchase',false,'completed')",[b,sb]);
  assert.equal(await claim(),true,'winning buyer retains its permitted closing conversation');
  assert.equal(await claim(a,sa),false,'other buyer stops after a signed purchase');
 });
 await isolated(async()=>{
  await q("insert into icash_signing_envelopes values($1,$2,'purchase',true,'completed')",[a,sa]);
  assert.equal(await claim(),true,'a test envelope is not a real purchase');
 });
 await isolated(async()=>{
  await q("update icash_screening_jobs set snapshot='{\"propertyId\":\"prop_cold\"}' where id=$1",[sc]);
  for(const invalid of ['12125550191','\\12125550191','+1','+1234567890123456'])assert.equal(await claim(stranger,sc,invalid),false);
  assert.equal(await claim(stranger,sc,'+12125550192'),true,'valid E.164 cold contact retains original exclusion checks');
  assert.equal(await one("select count(*)::int from icash_inventory_claims where account_id=$1",[stranger]),2);
 });
 for(const role of ['anon','authenticated'])for(const fn of ['icash_claim_inventory','icash_claim_cold_inventory'])assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,`public.${fn}(uuid,uuid,text)`]),false);
 console.log('PASS actual shared-seller SMS/call reservation regression, source binding, signed purchases, suppression, immutable cold claims and E.164 validation.');
}finally{await pg.close();}
