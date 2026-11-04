import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {textHealthSchema} from '../lib/text-health.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',account='00000000-0000-4000-8000-000000000001',thread='00000000-0000-4000-8000-000000000002',message='00000000-0000-4000-8000-000000000003',line='+17205550100',phone='+12145550100';
const health=async()=>textHealthSchema.parse(await one('select icash_owner_text_health($1)',[owner]));
const refresh=()=>one('select icash_refresh_work_before_research_quota()');
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema icash_reliability_private;grant usage on schema icash_reliability_private to service_role;
 create table icash_reliability_private.snapshots(id integer primary key,checked_at timestamptz,report jsonb);
 create function icash_seller_response_disposition(text) returns text language sql immutable as $$select null::text$$;
 create function icash_seller_direct_response_match(text,text) returns boolean language sql immutable as $$select false$$;
 create function icash_seller_sms_interest_at(uuid,uuid,timestamptz,timestamptz) returns timestamptz language sql stable as $$select null::timestamptz$$;
 create function public.icash_refresh_account_work_snapshot() returns jsonb language plpgsql set search_path='' as $$declare r jsonb;begin
 r:=jsonb_build_object('checkedAt',now(),'issueCount',7);insert into icash_reliability_private.snapshots values(1,now(),r) on conflict(id) do update set report=excluded.report;return r;end$$;`);
 const schema=JSON.parse(read('tests/fixtures/seller-text-health-schema.json'));
 for(const name of ['icash_text_senders','icash_text_threads','icash_text_messages','icash_operation_spend','icash_lifecycle_text_inbox','icash_customer_update_deliveries']){
  const table=schema.find(t=>t.name===name);await pg.exec(`create table public.${name} (${table.columns.map(c=>`"${c.name}" ${c.type}`).join(',')});`);
 }
 await pg.exec(read('config/seller-text-health.sql'));
 await pg.exec(read('config/incoming-text-reliability.sql'));
 await pg.exec('alter function icash_refresh_account_work_snapshot() rename to icash_refresh_work_before_research_quota');
 await q('insert into icash_text_senders values($1,true)',[line]);
 await q("insert into icash_text_threads(id,account_id,sender,recipient,party) values($1,$2,$3,$4,'seller')",[thread,account,line,phone]);
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,provider_id,body,created_at) values($1,$2,$3,'outgoing','delivered','original-outgoing','Fixture outgoing',now()-interval '1 hour')",[message,account,thread]);
 await q("insert into icash_operation_spend(operation_key,account_id,state,dispatched_at) values($1,$2,'dispatched',now()-interval '1 hour')",['text:'+message,account]);
 await q("insert into icash_lifecycle_text_inbox(event_id,recipient,sender,body,created_at) values('generic-reply',$1,$2,'Hello',now())",[line,phone]);
 assert.equal((await refresh()).incomingTexts.warningCount,0,'reproduce: generic inbox falsely clears property reception warning');
 const migration=read('config/property-text-reception-health.sql');assert.equal(migration,read('supabase/migrations/20261104141109_property_text_reception_health.sql'));
 await pg.exec(migration);
 let h=await health(),r=await refresh();
 assert.equal(h.lines[0].incomingStatus,'observed','generic transport evidence retained');
 assert.equal(h.lines[0].propertyIncomingStatus,'unverified');assert.equal(h.lines[0].otherIncoming24h,1);
 assert.equal(h.lines[0].propertyReplyRecipients24h,0);assert.equal(h.lines[0].lastPropertyIncomingAt,null);
 assert.equal(r.incomingTexts.warningCount,1);assert.equal(r.issueCount,8);assert.equal((await refresh()).issueCount,8);
 // Incorrect-account rows, carrier notices and receipt-less rows cannot prove routing.
 for(const [id,a,body,event] of [['10','00000000-0000-4000-8000-000000000009','Hello','wrong-account'],['11',account,'Free Msg: Message Blocking is active','carrier'],['12',account,'Hello',null]]){
  await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,event_id,body,created_at) values($1,$2,$3,'incoming','received',$4,$5,now())",['00000000-0000-4000-8000-'+id.padStart(12,'0'),a,thread,event,body]);
 }
 h=await health();assert.equal(h.lines[0].propertyIncomingStatus,'blocking_reported');assert.equal(h.lines[0].propertyReplyRecipients24h,0);
 await q("delete from icash_text_messages where event_id='carrier'");
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,event_id,body,created_at) values('00000000-0000-4000-8000-000000000013',$1,$2,'incoming','received','routed','I own it',now())",[account,thread]);
 await q("insert into icash_lifecycle_text_inbox(event_id,recipient,sender,body,created_at) values('routed',$1,$2,'I own it',now())",[line,phone]);
 h=await health();assert.equal(h.lines[0].propertyIncomingStatus,'observed');assert.equal(h.lines[0].propertyReplyRecipients24h,1);assert.equal(h.lines[0].otherIncoming24h,1,'duplicated lifecycle receipt is not counted as generic');assert.equal((await refresh()).issueCount,7);
 for(let n=0;n<3;n++)await one("select icash_record_text_ingress_failure('authenticated_rejected','parse_incoming')");
 await one("select icash_record_text_ingress_failure('processing_failed','property_ingestion')");
 h=await health();assert.equal(h.ingress.failedRequests24h,4);assert.equal(h.ingress.failures.length,2);assert(h.ingress.monitoredSince);
 r=await refresh();assert.equal(r.incomingTexts.warningCount,1,'failure warning remains even with a real routed reply');assert.equal(r.incomingTexts.lines.length,0);assert.equal(r.incomingTexts.lineWarningCount,0);assert.equal(r.incomingTexts.ingress.failedRequests24h,4);assert.equal((await refresh()).issueCount,8);
 for(const args of [[null,'parse_incoming'],['authenticated_rejected',null],['authenticated_rejected','property_ingestion'],['unknown','parse_incoming']])await assert.rejects(()=>one('select icash_record_text_ingress_failure($1,$2)',args),/Invalid text ingress/);
 for(const role of ['anon','authenticated'])for(const fn of ['icash_record_text_ingress_failure(text,text)','icash_text_ingress_health()','icash_owner_text_health(uuid)','icash_refresh_work_before_research_quota()'])assert.equal(await one("select has_function_privilege($1,$2,'execute')",[role,fn]),false);
 await assert.rejects(()=>one('select icash_owner_text_health($1)',[account]),/Owner required/);
 await q("update icash_reliability_private.text_ingress_failures set hour_at=hour_at-interval '25 hours'");
 assert.equal((await health()).ingress.failedRequests24h,0);assert.equal((await refresh()).issueCount,7);
 await q("update icash_text_messages set created_at=now()-interval '25 hours' where event_id='routed'");
 assert.equal((await refresh()).incomingTexts.warningCount,1,'recent generic inbox receipt does not refresh aged property evidence');
 await q('update icash_text_senders set enabled=false');assert.equal((await refresh()).incomingTexts.warningCount,0,'disabled line unchanged');
 // Failed health reads retain saved warnings and independent business checks.
 await q('update icash_text_senders set enabled=true');r=await refresh();
 await pg.exec("alter function icash_owner_text_health(uuid) rename to fixture_health;create function icash_owner_text_health(uuid) returns jsonb language plpgsql as $$begin raise exception 'fixture unavailable';end$$;");
 const failed=await refresh();assert.equal(failed.incomingTexts.fresh,false);assert.deepEqual(failed.incomingTexts.lines,r.incomingTexts.lines);assert.equal(failed.issueCount,8);
 assert.equal(await one('select count(*) from icash_operation_spend'),1,'diagnostics do not create or replay provider work');
 console.log('PASS property reply coverage independent of generic ingress; tenant/receipt binding, age, deduplication, failure aggregation, ACLs, bounded hourly window, stale preservation and no replay.');
}finally{await pg.close();}
