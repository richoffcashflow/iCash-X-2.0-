import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const q=(sql,args=[])=>pg.query(sql,args),hash=()=>createHash('sha256').update(randomUUID()).digest('hex');
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table icash_seller_intakes(id uuid primary key default gen_random_uuid(),state text default 'received',numbers_passed boolean default false,market_qualified boolean default false,checked_at timestamptz,created_at timestamptz default now(),attribution jsonb default '{}');`);
 await pg.exec(readFileSync(new URL('../config/homeoffer-optin-conversion.sql',import.meta.url),'utf8'));
 const guest=hash(),other=hash(),hidden=hash();
 const open=(g,v='fast_cash',s='meta',d='mobile')=>q('select icash_open_seller_optin($1,$2,$3,$4,$5) v',[g,v,s,'fixture',d]);
 const event=(g,e)=>q('select icash_record_seller_optin_event($1,$2)',[g,e]);
 assert.equal((await open(guest)).rows[0].v,'fast_cash');assert.equal((await open(guest,'ready')).rows[0].v,'fast_cash','Reload cannot switch assignment');
 await event(guest,'view');const viewed=(await q('select viewed_at from icash_seller_optin_visits')).rows[0].viewed_at;
 await event(guest,'view');assert.deepEqual((await q('select viewed_at from icash_seller_optin_visits')).rows[0].viewed_at,viewed,'View is exactly once');
 await event(guest,'start');await event(guest,'contact');await assert.rejects(event(guest,'qualified'),/Unknown opt-in event/);
 const lead=(await q('insert into icash_seller_intakes(attribution) values($1) returning id',[{optinGuest:guest}])).rows[0].id;
 assert.equal((await q('select lead_id from icash_seller_optin_visits where guest_hash=$1',[guest])).rows[0].lead_id,lead);
 await q('insert into icash_seller_intakes(attribution) values($1)',[{optinGuest:guest}]);
 assert.equal((await q('select lead_id from icash_seller_optin_visits where guest_hash=$1',[guest])).rows[0].lead_id,lead,'Multiple requests cannot increase visitor conversion count');
 await q("update icash_seller_optin_visits set created_at=now()-interval '3 days',viewed_at=now()-interval '3 days' where guest_hash=$1",[guest]);
 await q("update icash_seller_intakes set state='qualified',numbers_passed=true,market_qualified=true,checked_at=now()-interval '3 days'+interval '2 hours' where id=$1",[lead]);
 let report=(await q('select icash_seller_optin_report() r')).rows[0].r[0];
 assert.equal(report.views,1);assert.equal(report.submissions,1);assert.equal(report.matureViews,1);assert.equal(report.matureQualified,1);assert.equal(report.qualified,1);
 await q("update icash_seller_intakes set checked_at=now() where id=$1",[lead]);report=(await q('select icash_seller_optin_report() r')).rows[0].r[0];
 assert.equal(report.qualified,1);assert.equal(report.matureQualified,0,'Late qualification is reported, but cannot change the fixed 24-hour objective');
 await open(other,'ready','google','desktop');await event(other,'view');
 await q("insert into icash_seller_intakes(state,attribution) values('duplicate',$1)",[{optinGuest:other}]);
 assert.equal((await q('select lead_id from icash_seller_optin_visits where guest_hash=$1',[other])).rows[0].lead_id,null,'Duplicate leads do not count');
 await q('insert into icash_seller_intakes(attribution) values($1)',[{optinGuest:other,measurementOptOut:true}]);
 assert.equal((await q('select lead_id from icash_seller_optin_visits where guest_hash=$1',[other])).rows[0].lead_id,null,'Privacy opt-out does not attribute conversion');
 await open(hidden);await q('insert into icash_seller_intakes(attribution) values($1)',[{optinGuest:hidden}]);
 assert.equal((await q('select lead_id from icash_seller_optin_visits where guest_hash=$1',[hidden])).rows[0].lead_id,null,'Unseen assignments do not convert');
 const all=(await q('select icash_seller_optin_report() r')).rows[0].r;assert.equal(all.length,2,'Sources and devices remain separate');
 for(const role of ['anon','authenticated']){
  const permissions=(await q("select has_table_privilege($1,'icash_seller_optin_visits','select') readable,has_function_privilege($1,'icash_seller_optin_report()','execute') executable",[role])).rows[0];
  assert.equal(permissions.readable,false);assert.equal(permissions.executable,false);
 }
 assert.equal((await q("select relrowsecurity from pg_class where relname='icash_seller_optin_visits'")).rows[0].relrowsecurity,true);
 console.log('PASS isolated PostgreSQL: sticky assignment, one-time events, atomic server attribution, repeat/duplicate protection, matured windows, segmentation, opt-outs, private RPC and RLS.');
}finally{await pg.close();}
