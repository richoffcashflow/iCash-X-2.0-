// Offline PostgreSQL only; no provider, production call, text or purchase.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=await PGlite.create(),q=(s,p=[])=>db.query(s,p),val=async(s,p=[])=>Object.values((await q(s,p)).rows[0])[0];
const sql=read('config/outreach-predicate-performance.sql');
const baseline=JSON.parse(read('tests/fixtures/outreach-predicates-before.json'));
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_timezone_names(name text primary key);
 insert into icash_timezone_names select name from pg_timezone_names;
 set check_function_bodies=off;`);
 for(const row of baseline)await db.exec(row.definition);
 for(const row of baseline)await db.exec(`revoke all on function public.${row.signature} from public,anon,authenticated;grant execute on function public.${row.signature} to service_role;`);
 const metadata=()=>q(`select oid,proname,proacl,prosecdef,provolatile,proconfig from pg_proc where pronamespace='public'::regnamespace order by oid`);
 const before=(await metadata()).rows;
 // Preserve old hours under a separate name for a full behavior comparison.
 const oldHours=baseline.find(r=>r.signature.startsWith('icash_outreach_window_open'));
 await db.exec(oldHours.definition.replace('public.icash_outreach_window_open','public.fixture_previous_hours'));
 await db.exec(sql);
 const after=(await metadata()).rows.filter(r=>r.proname!=='fixture_previous_hours');
 assert.deepEqual(after,before,'identities, private grants, security mode, clock volatility and search path are unchanged');
 const newBody=await val("select prosrc from pg_proc where oid='icash_owner_demo_call_current(uuid,uuid)'::regprocedure");
 const oldBody=await val("select $1::text",[baseline.find(r=>r.signature.startsWith('icash_owner_demo_call')).definition.split('AS $function$')[1].split('$function$')[0]]);
 assert.equal(newBody.slice(newBody.indexOf(' return exists(')+15,-5),oldBody.slice(16),'owner evidence query retained byte for byte');
 // No owner evidence relations exist in this isolated fixture. An ordinary
 // account must return before PostgreSQL even plans that unrelated query.
 for(const [account,job] of [['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'],[null,'22222222-2222-4222-8222-222222222222'],['48dfb798-8c1a-404f-88c0-c396cc067062',null]])
  assert.equal(await val('select icash_owner_demo_call_current($1,$2)',[account,job]),false);
 await assert.rejects(q("select icash_owner_demo_call_current('48dfb798-8c1a-404f-88c0-c396cc067062','22222222-2222-4222-8222-222222222222')"),/icash_voice_jobs/,'the owner still executes the entire original evidence query');
 const scenarios=await q(`with zones as (select name from icash_timezone_names union all select null union all select 'Invented/Zone' union all select ' '),
 bases as (select unnest(array[null,'conservative_nanp_window','business_operating_clock','verified_recipient_location']) basis),
 clocks as (select unnest(array['2026-11-01 14:59:59+00'::timestamptz,'2026-11-01 15:00:00+00','2026-11-02 02:59:59+00','2026-11-02 03:00:00+00','2026-03-08 13:59:59+00','2026-03-08 14:00:00+00',null,'infinity','-infinity']) stamp)
 select count(*) tested,count(*) filter(where icash_outreach_window_open(name,basis,stamp) is distinct from fixture_previous_hours(name,basis,stamp)) mismatches from zones cross join bases cross join clocks`);
 assert.equal(scenarios.rows[0].mismatches,0,'all known timezones, DST boundaries, business fallbacks and invalid/infinite clocks match');
 const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>x.endsWith('_outreach_predicate_performance.sql'));
 assert.equal(migration.length,1);assert.equal(read('supabase/migrations/'+migration[0]),sql);
 console.log(`Outreach predicates: ${scenarios.rows[0].tested} exact hours comparisons, no ordinary-account owner-query planning, original owner evidence and ACL/OID/volatility preserved.`);
}finally{await db.close();}
