// Synthetic actual-function regressions. No providers or production credentials.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const before=JSON.parse(read('tests/fixtures/workflow-stall-before.json'));
const sql=read('config/workflow-stall-isolation.sql');
const name=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_workflow_stall_isolation.sql'));
assert.equal(read('supabase/migrations/'+name),sql);
const pg=await PGlite.create(),q=(s,p=[])=>pg.query(s,p),one=async(s,p=[])=>Object.values((await q(s,p)).rows[0])[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,a=id(1),b=id(2),screen=id(3),deal=id(4),thread=id(5),message=id(6),job=id(7),target=id(8);
const warm=(account=a,old=false)=>one(`select icash_work_private.${old?'warm_before':'warm_seller_due'}($1)`,[account]);
const hours=(stamp,account=a,t=thread,old=false)=>one(`select public.${old?'hours_before':'icash_sms_outreach_window_current'}($1,$2,$3)`,[account,t,stamp]);
const parity=async expected=>{assert.equal(await warm(),expected);assert.equal(await warm(a,true),expected);};
try{
 await pg.exec('create role anon;create role authenticated;create role service_role;'+read('tests/fixtures/workflow-stall-schema.sql'));
 const first=read('config/first-contact-hours.sql');
 for(const fn of ['icash_outreach_timezone','icash_outreach_window_open'])await pg.exec(first.match(new RegExp(`create function public\\.${fn}[\\s\\S]*?\\$\\$;`))[0]);
 for(const row of before)await pg.exec(row.definition);
 await pg.exec('revoke all on function icash_work_private.warm_seller_due(uuid),public.icash_sms_outreach_window_current(uuid,uuid,timestamptz) from public,anon,authenticated;grant execute on function icash_work_private.warm_seller_due(uuid),public.icash_sms_outreach_window_current(uuid,uuid,timestamptz) to service_role;');
 for(const row of before)await pg.exec(row.definition.replace('icash_work_private.warm_seller_due(', 'icash_work_private.warm_before(').replace('public.icash_sms_outreach_window_current(', 'public.hours_before('));
 // The old real predicate performs a global scan even for an empty account.
 await warm();assert.equal(await one('select is_called from capacity_scans'),true);
 await pg.exec(sql);
 await pg.exec('alter sequence capacity_scans restart');assert.equal(await warm(),false);assert.equal(await one('select is_called from capacity_scans'),false);
 await q("insert into icash_screening_jobs values($1,$2,'{\"propertyId\":\"fixture\"}')",[screen,a]);
 await q("insert into icash_deal_files values($1,$2,$3,'{}')",[deal,a,screen]);
 await q("insert into icash_text_threads values($1,$2,$3,'seller','+12145550123','auto',false,false,null,now()+interval '1 day',null,'America/Chicago',null)",[thread,a,deal]);
 await q("insert into icash_text_messages values($1,$2,$3,'incoming','received','fixture',null,now(),'Please make me an offer')",[message,a,thread]);
 await q("insert into icash_text_ai_jobs values($1,$2,$3,$4,'pending',now(),null)",[id(9),a,thread,message]);
 await parity(true);
 await pg.exec('alter sequence capacity_scans restart');assert.equal(await warm(),true);assert.equal(await one('select is_called from capacity_scans'),false,'Text work is independent of voice capacity');
 for(const [change,undo] of [
  ["update icash_text_threads set paused=true","update icash_text_threads set paused=false"],
  ["update icash_text_threads set manual_only=true","update icash_text_threads set manual_only=false"],
  ["update icash_text_messages set body='STOP'","update icash_text_messages set body='Please make me an offer'"],
  ["update icash_text_messages set provider_id=null","update icash_text_messages set provider_id='fixture'"],
  ["update icash_text_messages set created_at=now()-interval '6 minutes';update icash_text_ai_jobs set next_attempt_at=now()-interval '6 minutes'","update icash_text_messages set created_at=now();update icash_text_ai_jobs set next_attempt_at=now()"],
  ["insert into icash_text_suppressions values('+12145550123')","delete from icash_text_suppressions"],
  [`insert into icash_property_controls values('${a}','fixture',true)`,"delete from icash_property_controls"],
 ]){await pg.exec(change);await parity(false);await pg.exec(undo);await parity(true);}
 assert.equal(await warm(b),false);
 await pg.exec('delete from icash_text_ai_jobs');
 await q("insert into icash_voice_jobs values($1,$2,$3,null,'ready',now(),$4,null,null,null)",[job,a,target,id(10)]);
 await q("insert into icash_voice_contact_targets values($1,$2,$3,'seller','+12145550123','fixture-contact',null,now()+interval '1 day',true)",[target,a,screen]);
 await parity(true);await pg.exec('alter sequence capacity_scans restart');assert.equal(await warm(),true);assert.equal(await one('select last_value from capacity_scans'),1);
 for(const [change,undo] of [
  ['update fixture_checks set capacity=false','update fixture_checks set capacity=true'],
  ['update fixture_checks set capacity=null','update fixture_checks set capacity=true'],
  ['update fixture_checks set hours=false','update fixture_checks set hours=true'],
  ['update icash_voice_contact_targets set dnc_clear=false','update icash_voice_contact_targets set dnc_clear=true'],
  ["update icash_voice_contact_targets set revoked_at=now()","update icash_voice_contact_targets set revoked_at=null"],
  ["update icash_voice_jobs set due_at=now()-interval '6 minutes'","update icash_voice_jobs set due_at=now()"],
  ["update icash_voice_jobs set operation_key='original-unknown'","update icash_voice_jobs set operation_key=null"],
  ["update icash_voice_jobs set provider_call_sid='original-call'","update icash_voice_jobs set provider_call_sid=null"],
  ["insert into icash_contact_suppressions values('fixture-contact')","delete from icash_contact_suppressions"],
 ]){await pg.exec(change);await parity(false);await pg.exec(undo);await parity(true);}
 await pg.exec('update fixture_checks set hours=false;alter sequence capacity_scans restart');assert.equal(await warm(),false);assert.equal(await one('select is_called from capacity_scans'),false,'No global scan for an ineligible callback');
 await pg.exec('update fixture_checks set hours=true');
 // Daytime bypasses only the historical exception, never account/thread routing.
 const day='2026-11-09T18:00:00Z',night='2026-11-10T04:00:00Z';
 await pg.exec('alter sequence history_scans restart');assert.equal(await hours(day,a,thread,true),true);assert.equal(await one('select is_called from history_scans'),true);
 await pg.exec('alter sequence history_scans restart');assert.equal(await hours(day),true);assert.equal(await one('select is_called from history_scans'),false);
 for(const history of [true,false,null]){
  await q('update fixture_checks set history=$1',[history]);
  for(const stamp of [day,night,'2026-11-10T03:00:00Z','2026-11-09T14:59:59Z','2026-11-09T15:00:00Z',null,'infinity'])assert.equal(await hours(stamp),await hours(stamp,a,thread,true));
 }
 assert.equal(await hours(day,b),false);assert.equal(await hours(day,a,id(99)),false);
 await pg.exec('update icash_text_threads set retired_at=now()');assert.equal(await hours(day),false);
 for(const role of ['anon','authenticated'])for(const signature of ['icash_work_private.warm_seller_due(uuid)','public.icash_sms_outreach_window_current(uuid,uuid,timestamptz)'])assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 // Both exact predecessor guards run before either replacement.
 const changed=await one("select pg_get_functiondef('icash_work_private.warm_seller_due(uuid)'::regprocedure)");
 await assert.rejects(pg.exec(sql),/Workflow isolation prerequisite changed/);await pg.exec('rollback');
 assert.equal(await one("select pg_get_functiondef('icash_work_private.warm_seller_due(uuid)'::regprocedure)"),changed);
 await pg.exec(before.find(r=>r.definition.includes('FUNCTION icash_work_private.warm_seller_due(')).definition);
 const originalWarm=await one("select pg_get_functiondef('icash_work_private.warm_seller_due(uuid)'::regprocedure)");
 await assert.rejects(pg.exec(sql),/Workflow isolation prerequisite changed: public.icash_sms/);await pg.exec('rollback');
 assert.equal(await one("select pg_get_functiondef('icash_work_private.warm_seller_due(uuid)'::regprocedure)"),originalWarm,'Second prerequisite drift cannot partly change the first helper');
 console.log('PASS workflow isolation: predecessor reproduction, skipped unrelated scans, warm reply/callback parity, source/Pause/unknown-call holds, daytime/overnight boundaries, private ACLs and atomic drift rejection.');
}finally{await pg.close();}
