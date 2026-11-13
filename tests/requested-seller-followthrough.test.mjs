import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const baseline=JSON.parse(read('tests/fixtures/requested-seller-predecessors.json'));
const fn=n=>baseline.find(x=>x.signature.startsWith(n+'(')).definition+';';
const fix=read('config/requested-seller-followthrough.sql');
assert.equal(fix,read('supabase/migrations/20261113170818_requested_seller_followthrough.sql'));
const sender='+14357242174',a=await one("select md5('owner')::uuid");
try{
 await pg.exec(read('tests/fixtures/contiguity-volume-predecessors.sql')+read('tests/fixtures/contiguity-volume-admission.sql'));
 await pg.exec(`
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table icash_sms_seller_openings(thread_id uuid,account_id uuid,owner_question_id uuid);
 create table icash_text_assets(id uuid,url text,bytes bigint,account_id uuid,deal_id uuid,verified_until timestamptz);
 create unique index fixture_request_key on icash_text_messages(request_key);
 alter table icash_text_messages alter column id set default gen_random_uuid();
 alter table icash_text_messages alter column created_at set default now();
 create function icash_seller_text_cadence_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_outreach_sms_current(uuid) returns boolean language sql as $$select true$$;
 create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select true$$;
 create function icash_conversation_street(text) returns text language sql as $$select $1$$;
 create function icash_seller_contact_evidence(uuid,uuid,uuid,text) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function icash_seller_recipient_opener(uuid,uuid,text,text,text) returns text language sql as $$select 'Hi, are you the owner of 123 Fixture Street?'$$;
 create function icash_seller_cash_questions_enabled() returns boolean language sql as $$select false$$;
 create function icash_sms_single_segment(text) returns boolean language sql as $$select length($1)<=160$$;
 create function icash_assign_seller_opener_v6(a uuid,t uuid) returns jsonb language plpgsql set search_path=public as $$begin
  insert into icash_seller_opener_assignments(thread_id,account_id) values(t,a);return '{"context":"fixture"}'::jsonb;end$$;
 insert into icash_operating_budget(id,enabled) values(1,true);
 insert into icash_customer_identities(account_id,principal) values(md5('owner')::uuid,'Fixture Homes');
 `);
 await pg.exec(read('supabase/migrations/20261106190817_contiguity_sender_volume.sql')+read('config/november-sender-pacing.sql')+read('config/november-sender-200.sql')+read('config/november-additional-sender-pacing.sql')+read('config/november-11-sender-pacing.sql')+fn('icash_queue_text')+fn('icash_queue_seller_opener'));
 await pg.exec(read('config/seller-opener-delivery-order.sql')+`create trigger icash_seller_opener_observation after insert or update of state on public.icash_text_messages for each row execute function public.icash_observe_seller_opener();`);
 const seed=async key=>{
  const t=await one('select fixture_thread($1,$2)',[key,sender]);
  const lead=await one("select md5('lead'||$1)::uuid",[key]),s=await one("select md5('screen'||$1)::uuid",[key]),d=await one("select md5('deal'||$1)::uuid",[key]);
  await q("insert into icash_screening_jobs(id,account_id,snapshot) values($1,$2,jsonb_build_object('sellerRequest',jsonb_build_object('id',$3::text)))",[s,a,lead]);
  await q("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$3,'draft',$4)",[d,a,s,{address:"123 Fixture Street"}]);
  await q("update icash_text_threads set deal_id=$2,seller_intake_id=$3,manual_only=false,permission_until=now()+interval '1 day',permission_evidence='fixture-only' where id=$1",[t,d,lead]);
  await q("insert into icash_seller_intakes(id,phone,ai_consented,state,name) select $1,recipient,true,'assigned','Pat' from icash_text_threads where id=$2",[lead,t]);
  await q('insert into icash_seller_matches values($1,$2,$3)',[lead,a,s]);
  return {t,lead,s,d};
 };
 const queue=t=>one('select icash_queue_seller_opener($1,$2)',[a,t]);
 const claim=m=>one('select icash_claim_text($1,$2,$3)',[a,m,sender]);
 await q("insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) values('fixture',md5('recent')::uuid,$1,true,now()-interval '1 minute')",[sender]);
 const fresh=await seed('fresh');
 assert.equal(await queue(fresh.t),null,'reproduces requested opener blocked by unrelated cold pacing');
 await pg.exec(fix);
 const m=await queue(fresh.t);assert(m,'requested opener queues through real opener function');
 assert.deepEqual(await claim(m),{from:sender},'original claim and shared sender trigger admit warm introduction');
 assert.equal(await claim(m),null,'never duplicate an already claimed send');
 assert.equal(await queue(fresh.t),null,'never queue a second opener');
 assert.equal(await one("select cold from icash_sender_private.uses where source='property' and source_id=$1",[m]),false);
 for(const [key,change] of [
  ['consent',f=>q('update icash_seller_intakes set ai_consented=false where id=$1',[f.lead])],
  ['recipient',f=>q("update icash_seller_intakes set phone='+12025550199' where id=$1",[f.lead])],
  ['tenant',f=>q("update icash_seller_matches set account_id=md5('other')::uuid where lead_id=$1",[f.lead])],
  ['source',f=>q("update icash_screening_jobs set snapshot='{}' where id=$1",[f.s])],
  ['missing-permission',f=>q('update icash_text_threads set permission_until=null where id=$1',[f.t])],
  ['expired',f=>q("update icash_text_threads set permission_until=now()-interval '1 second' where id=$1",[f.t])],
  ['stop',f=>q('insert into icash_text_suppressions(phone) select recipient from icash_text_threads where id=$1',[f.t])],
  ['manual',f=>q('update icash_text_threads set manual_only=true where id=$1',[f.t])],
 ]){const f=await seed(key);await change(f);assert.equal(await queue(f.t),null,key);}
 const tampered=await seed('tampered'),bad=await queue(tampered.t);
 await q("update icash_text_messages set body='Unrelated outreach' where id=$1",[bad]);
 assert.equal(await claim(bad),null,'warm intake cannot exempt arbitrary unbound copy');
 const ct=await one('select fixture_thread($1,$2)',['contract',sender]),cm=await one('select fixture_message($1,$2)',['contract',ct]);
 await q('insert into icash_contract_text_deliveries(account_id,thread_id,message_id) values($1,$2,$3)',[a,ct,cm]);
 assert.deepEqual(await claim(cm),{from:sender},'authorized contract delivery retains warm sender capacity');
 const full=await seed('full');
 await q("insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) select 'full',md5(i::text)::uuid,$1,false,now() from generate_series(1,1000)i",[sender]);
 assert.equal(await queue(full.t),null,'total provider capacity remains enforced');
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_sender_private.requested_introduction(icash_text_threads)','execute')",[role]),false);
 console.log('PASS requested introductions: actual queue/claim/trigger, cold pacing reproduction, consent/source/tenant controls, no duplicate, contract classification and total capacity. External provider and permission adapters are fixture-only.');
}finally{await pg.close();}
