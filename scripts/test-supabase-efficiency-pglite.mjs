// Isolated PostgreSQL, synthetic records only. No external calls or production writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table icash_automation_tickets(id uuid primary key,kind text,created_at timestamptz,expires_at timestamptz,state text,opener_message_id uuid);
 create function icash_timezone_check(zone text) returns boolean language sql stable set search_path='' as $$select exists(select 1 from pg_catalog.pg_timezone_names where name=zone)$$;
 create function icash_timezone_join(zone text,at_time timestamptz) returns timestamp language sql stable set search_path='' as $$select at_time at time zone tz.name from pg_timezone_names tz where tz.name=zone$$;
 revoke all on function icash_timezone_check(text),icash_timezone_join(text,timestamptz) from public,anon,authenticated;
 grant execute on function icash_timezone_check(text),icash_timezone_join(text,timestamptz) to service_role;`);
 const q=(s,p=[])=>pg.query(s,p);
 const before=(await q("select oid,prosrc,proacl,prosecdef,provolatile,proconfig from pg_proc where proname in ('icash_timezone_check','icash_timezone_join') order by oid")).rows;
 await pg.exec(read('config/supabase-efficiency.sql'));
 const after=(await q("select oid,prosrc,proacl,prosecdef,provolatile,proconfig from pg_proc where proname in ('icash_timezone_check','icash_timezone_join') order by oid")).rows;
 for(let i=0;i<before.length;i++){
  const expected=before[i].prosrc.replaceAll('pg_catalog.pg_timezone_names','public.icash_timezone_names').replace(/\bpg_timezone_names\b/g,'public.icash_timezone_names');
  assert.equal(after[i].prosrc,expected);
  for(const key of ['oid','proacl','prosecdef','provolatile','proconfig'])assert.deepEqual(after[i][key],before[i][key]);
 }
 assert.equal((await q('select count(*)::int n from ((select name from pg_timezone_names except select name from icash_timezone_names) union all (select name from icash_timezone_names except select name from pg_timezone_names)) d')).rows[0].n,0);
 for(const zone of ['America/Chicago','UTC','Pacific/Kiritimati'])assert.equal((await q('select icash_timezone_check($1) ok',[zone])).rows[0].ok,true);
 for(const zone of ['No/Such_Zone','',null])assert.equal((await q('select icash_timezone_check($1) ok',[zone])).rows[0].ok,false);
 for(const instant of ['2026-03-08T07:59:00Z','2026-03-08T08:01:00Z','2026-11-01T06:59:00Z','2026-11-01T07:01:00Z']){
  const row=(await q("select icash_timezone_join('America/Chicago',$1)=($1::timestamptz at time zone 'America/Chicago') ok",[instant])).rows[0];assert.equal(row.ok,true);
 }
 for(const role of ['anon','authenticated']){
  assert.equal((await q("select has_table_privilege($1,'icash_timezone_names','select') ok",[role])).rows[0].ok,false);
  assert.equal((await q("select has_function_privilege($1,'icash_refresh_timezone_names()','execute') ok",[role])).rows[0].ok,false);
 }
 assert.equal((await q("select has_function_privilege('service_role','icash_refresh_timezone_names()','execute') ok")).rows[0].ok,false);
 await pg.exec('set role service_role');
 assert.equal((await q("select icash_timezone_check('America/Chicago') ok")).rows[0].ok,true);
 await assert.rejects(q("insert into icash_timezone_names values('Not/A_Zone')"));
 await pg.exec('reset role');
 await pg.exec("delete from icash_timezone_names where name='UTC';select icash_refresh_timezone_names();");
 assert.equal((await q("select icash_timezone_check('UTC') ok")).rows[0].ok,true);
 assert.equal((await q("select count(*)::int n from pg_indexes where indexname in ('icash_automation_kind_recent','icash_automation_expiring','icash_automation_opener_history')")).rows[0].n,3);
 console.log('PASS Supabase efficiency: identical valid names, DST behavior, function identities/grants/security preserved, private read-only catalog, owner-only refresh and queue indexes.');
}finally{await pg.close();}
