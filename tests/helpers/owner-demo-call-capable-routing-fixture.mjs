import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

export async function testOwnerDemoRouting(f){
 const {db,q,one,recipient}=f;
 const owner='48dfb798-8c1a-404f-88c0-c396cc067062',actor='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
 const screen='00000000-0000-4000-8000-000000000101',deal='00000000-0000-4000-8000-000000000102';
 const lead='00000000-0000-4000-8000-000000000103',request='00000000-0000-4000-8000-000000000104';
 const textOnly='+15127791343',dual='+18623812530',ac='AC'+'a'.repeat(32),pn='PN'+'b'.repeat(32);
 await f.reset();
 await db.exec(`create table icash_seller_intakes(id uuid,request_id uuid,assigned_account uuid,screening_id uuid,phone text,state text,ai_consented boolean,contact_consent_scope text,attribution jsonb);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table icash_optin_call_requests(lead_id uuid,request_id uuid,phone text,account_id uuid,requested_by uuid,source text,request_version text,request_reference text,expires_at timestamptz);
 create function icash_outreach_voice_current(uuid) returns boolean language sql stable as $$select exists(select 1 from public.icash_voice_configs where account_id=$1 and enabled and reviewed_until>now())$$;`);
 await q('insert into icash_accounts(id,owner_user_id) values($1,$2)',[owner,actor]);
 await q('insert into icash_screening_jobs(id,account_id) values($1,$2)',[screen,owner]);
 await q('insert into icash_deal_files(id,account_id,screening_id) values($1,$2,$3)',[deal,owner,screen]);
 await q("insert into icash_voice_configs(account_id,enabled,reviewed_until) values($1,true,now()+interval '1 day')",[owner]);
 await q("insert into icash_seller_intakes values($1,$2,$3,$4,$5,'assigned',true,'icash_x_demo',jsonb_build_object('demoAccountId',$3::uuid::text))",[lead,request,owner,screen,recipient]);
 await q('insert into icash_seller_matches values($1,$2,$3)',[lead,owner,screen]);
 await q("insert into icash_optin_call_requests values($1,$2,$3,$4,$5,'demo_form','icash-optin-call-now-2026-10-16.1','icash-optin-call-now-2026-10-16.1',now()+interval '5 minutes')",[lead,request,recipient,owner,actor]);
 const clean=async()=>{await f.reset();await db.exec('truncate icash_text_messages,icash_property_controls;update icash_text_senders set enabled=false;update icash_business_voice_numbers set outbound_enabled=false;');await q('update icash_text_senders set enabled=true where phone=$1',[textOnly]);await q('update icash_business_voice_numbers set caller_id_sid=null where phone=$1',[textOnly]);};
 const sms=async()=>(await one('select icash_property_text_sender($1,$2,$3) sender',[owner,deal,recipient])).sender;
 const voice=async()=>(await one('select icash_property_call_sender($1,$2,$3) sender',[owner,screen,recipient])).sender;
 const enableDual=async()=>{await q('update icash_text_senders set enabled=true where phone=$1',[dual]);await q('update icash_business_voice_numbers set outbound_enabled=true,forwarding_ready=true,caller_id_sid=$2 where phone=$1',[dual,pn]);};
 const definition=async()=>(await one("select pg_get_functiondef('icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure) d")).d;
 const metadata=async()=>(await one("select provolatile,prosecdef,proconfig,proacl from pg_proc where oid='icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure"));
 const before=await metadata(),old=await definition(),patch=readFileSync('config/owner-demo-call-capable-routing.sql','utf8');
 await clean();assert.equal(await sms(),textOnly,'Reproduce the original SMS-only first allocation');await f.thread(textOnly,owner,deal);assert.equal(await voice(),null,'That thread prevents the requested call');
 await clean();await db.exec(old.replace('has_thread boolean:=false;','has_thread boolean := false;'));
 await assert.rejects(db.exec(patch),/selector declaration changed/);await q('rollback');await db.exec(old);
 const stateBefore=(await q('select * from icash_text_senders order by phone')).rows;
 await db.exec(patch);await db.exec(patch);
 assert.deepEqual(await metadata(),before,'Keep stable/invoker/search-path/private ACL metadata');
 assert.deepEqual((await q('select * from icash_text_senders order by phone')).rows,stateBefore,'Never enable a number');
 assert.equal(await sms(),null,'Never pin a fresh call-requested demo to the text-only lease');
 await enableDual();assert.equal(await sms(),dual);await f.thread(dual,owner,deal);assert.equal(await voice(),dual,'Text preparation and final voice selection share the verified caller');
 await q('update icash_business_voice_numbers set outbound_enabled=false where phone=$1',[dual]);assert.equal(await voice(),null,'Later caller disable still holds the established route');
 await clean();await enableDual();await f.thread(textOnly,owner,deal);assert.equal(await sms(),textOnly);assert.equal(await voice(),null,'Existing SMS-only threads never rotate silently');
 await clean();await enableDual();await q("insert into icash_call_recordings(account_id,screening_id,from_phone,to_phone,party,state,provider_account_sid) values($1,$2,$3,$4,'seller','needs_review',$5)",[owner,screen,dual,recipient,ac]);
 await q('update icash_text_senders set enabled=false where phone=$1',[dual]);assert.equal(await sms(),null,'Unknown recorded calls retain the original identity');assert.equal(await voice(),dual);
 await clean();await q('update icash_voice_configs set enabled=false where account_id=$1',[owner]);assert.equal(await sms(),textOnly,'Explicit SMS-only account choices keep SMS capacity');await q('update icash_voice_configs set enabled=true where account_id=$1',[owner]);
 assert.equal((await one('select icash_business_conversation_sender($1,$2,$3) sender',[f.account,f.screen,recipient])).sender,textOnly,'Other accounts keep their existing allocation');
 for(const [change,restore] of [
  ["update icash_seller_intakes set ai_consented=false","update icash_seller_intakes set ai_consented=true"],
  ["update icash_seller_intakes set contact_consent_scope='network_pool'","update icash_seller_intakes set contact_consent_scope='icash_x_demo'"],
  ["update icash_seller_intakes set attribution='{}'","update icash_seller_intakes set attribution=jsonb_build_object('demoAccountId',assigned_account::text)"],
  ["update icash_optin_call_requests set source='support_request'","update icash_optin_call_requests set source='demo_form'"],
  ["update icash_optin_call_requests set request_reference='other'","update icash_optin_call_requests set request_reference=request_version"],
  ["update icash_optin_call_requests set requested_by=null",`update icash_optin_call_requests set requested_by='${actor}'`],
  ["update icash_seller_matches set screening_id=null",`update icash_seller_matches set screening_id='${screen}'`]
 ]){await db.exec(change);assert.equal(await sms(),textOnly,'A mismatched source never gains the private demo policy');await db.exec(restore);}
 const expiry=(await one('select expires_at from icash_optin_call_requests')).expires_at;
 await enableDual();assert.equal(await sms(),dual);assert.deepEqual((await one('select expires_at from icash_optin_call_requests')).expires_at,expiry,'Selection never renews contact permission');
 await q('insert into icash_text_suppressions values($1)',[recipient]);assert.equal(await sms(),null);assert.equal(await voice(),null,'Opt-outs still block both channels');
 await clean();await enableDual();await q('insert into icash_sms_routes values($1,$2,$3,true)',[dual,recipient,owner]);assert.equal(await sms(),null,'Route review cannot be evaded with the text-only lease');
 await clean();await enableDual();await q('insert into icash_sms_routes values($1,$2,$3,false)',[dual,recipient,f.other]);assert.equal(await sms(),null,'Other account ownership remains binding');
 assert(!/pg_advisory|for update|for share|insert into|update public|delete from/i.test(await definition()),'Selection remains read-only');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'icash_business_conversation_sender(uuid,uuid,text,boolean)','execute') allowed",[role])).allowed,false);
 if(process.env.OWNER_DEMO_CONFIRMED_SENDER_ONLY==='1')await (await import('./owner-demo-confirmed-sender-fixture.mjs')).testOwnerDemoConfirmedSender({...f,owner,actor,demoScreen:screen,demoDeal:deal,lead,request});
 console.log('PASS owner demo call routing: reproduced failed first allocation; verified dual-channel selection, existing/unknown identity, source and account boundaries, SMS-only choice, disabled number, opt-out, private ACL, drift rollback and idempotence.');
}
