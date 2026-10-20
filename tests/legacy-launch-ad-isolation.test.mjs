import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';

let token,rows=[],reads=0;
const deps={legacyLaunchCookie:'icash_legacy_launch',launchTokenPattern:/^[a-f0-9]{64}$/,
 cookies:async()=>({get:()=>token?{value:token}:undefined}),db:async()=>{reads++;return rows;}};
globalThis.__legacyMeasurement=deps;
const code=ts.transpileModule(readFileSync(new URL('../lib/legacy-launch-measurement.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {legacyAdMeasurementExcluded}=await import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(deps).join(',')}}=globalThis.__legacyMeasurement;\n`+code).toString('base64'));
const request=page=>new Request('https://example.test/api/webinar/pixel'+(page?'?page='+encodeURIComponent(page):''));
try{
 token='a'.repeat(64);assert.equal(await legacyAdMeasurementExcluded(request('/join')),true);assert.equal(reads,0);
 token=undefined;rows=[{config:{legacyCampaignId:'campaign'}}];
 assert.equal(await legacyAdMeasurementExcluded(request('/live/100004')),true,'Private recording excluded before a session exists');
 assert.equal(await legacyAdMeasurementExcluded(request('/join?webinar_session=00000000-0000-4000-8000-000000000001')),true);
 assert.equal(await legacyAdMeasurementExcluded(request(), 'visitor'),true,'VIP and checkout returns retain private context');
 rows=[{config:{}}];assert.equal(await legacyAdMeasurementExcluded(request('/live/100000')),false,'Ordinary ads keep their existing pixel');
 assert.equal(await legacyAdMeasurementExcluded(request('https://elsewhere.test/live/100004')),false);
}finally{delete globalThis.__legacyMeasurement;}

const pg=await PGlite.create(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_webinar_visitors(id uuid primary key,email text,marketing_consent_at timestamptz,measurement jsonb default '{}');
 create table icash_webinar_sessions(id uuid primary key,config jsonb default '{}');
 create table icash_membership_invoices(membership_id uuid,stripe_payment_id text,recorded_at timestamptz);
 create table icash_plan_changes(membership_id uuid,payment_id text,applied_at timestamptz);
 create table icash_legacy_checkouts(membership_id uuid,created_at timestamptz);
 create table icash_billing_reviews(payment_id text);
 create table icash_webinar_settings(id int,config jsonb);insert into icash_webinar_settings values(1,'{"meta":{"enabled":true}}');
 create table fixture_payments(payment_id text,value_cents bigint,occurred_at timestamptz,session_id uuid,visitor_id uuid,purchase_kind text);
 create function icash_webinar_meta_purchases() returns setof fixture_payments language sql as $$select * from public.fixture_payments$$;
 create function icash_webinar_attributed_purchases() returns setof fixture_payments language sql as $$select payment_id,value_cents,occurred_at,session_id as id,visitor_id,purchase_kind from public.fixture_payments$$;
 create table icash_webinar_meta_events(event_id text primary key,payment_id text unique,visitor_id uuid,session_id uuid,value_cents bigint,occurred_at timestamptz,purchase_kind text,state text default 'pending',payload jsonb,due_at timestamptz default now(),attempts int default 0,claimed_at timestamptz);`);
 await pg.exec(readFileSync(new URL('../config/webinar-automatic-measurement.sql',import.meta.url),'utf8'));
 const q=(sql,args=[])=>pg.query(sql,args);
 await q("insert into icash_webinar_visitors(id,marketing_consent_at) values($1,now()-interval '1 day')",[id(1)]);
 await q("insert into icash_webinar_sessions values($1,'{}'),($2,'{\"legacyCampaignId\":\"campaign\"}')",[id(2),id(3)]);
 await q("insert into icash_legacy_checkouts values($1,now()-interval '1 hour')",[id(4)]);
 await q("insert into icash_membership_invoices values($1,'pi_direct',now())",[id(4)]);
 await q("insert into icash_plan_changes values($1,'pi_vip',now())",[id(4)]);
 for(const [payment,session,kind] of [['pi_ad',id(2),'membership'],['pi_private',id(3),'membership'],['pi_direct',id(2),'membership'],['pi_vip',null,'vip_upgrade']]){
  await q('insert into fixture_payments values($1,5000,now(),$2,$3,$4)',[payment,session,id(1),kind]);
 }
 await pg.exec('select icash_webinar_sync_purchases()');
 assert.equal((await q('select * from icash_webinar_meta_events')).rows.length,4);
 await pg.exec(readFileSync(new URL('../config/legacy-launch-ad-isolation.sql',import.meta.url),'utf8'));
 for(const fn of ['icash_webinar_meta_purchases','icash_webinar_attributed_purchases'])assert.deepEqual((await q(`select payment_id from ${fn}()`)).rows.map(r=>r.payment_id),['pi_ad'],'Private purchases cannot fall back into old ad attribution');
 assert.equal((await q("select count(*)::int count from icash_webinar_meta_events where state='canceled'")).rows[0].count,3);
 // A late/retried event still cannot be claimed; sync removes it again.
 await pg.exec("update icash_webinar_meta_events set state='pending'");
 assert.deepEqual((await q('select payment_id from icash_webinar_claim_meta()')).rows.map(r=>r.payment_id),['pi_ad']);
 await pg.exec('select icash_webinar_sync_purchases()');
 assert.equal((await q("select count(*)::int count from icash_webinar_meta_events where state='canceled'")).rows[0].count,3);
 assert.equal((await q('select count(*)::int count from fixture_payments')).rows[0].count,4,'Real receipts retained');
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,'icash_legacy_meta_excluded(text,uuid)','execute') allowed",[role])).rows[0].allowed,false);
 console.log('PASS private customer campaign: invitation, recording, signup and VIP pixel isolation; separate purchase reports, Meta queue/claim guards, real receipts and ordinary ad behavior.');
}finally{await pg.close();}
