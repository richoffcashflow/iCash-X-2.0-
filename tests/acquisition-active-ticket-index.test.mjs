import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(sql,args=[])=>pg.query(sql,args),v=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const definitions=JSON.parse(read('tests/fixtures/owner-preflight-priority-before.json'));
const walk=n=>[n,...(n.Plans??[]).flatMap(walk)];
try{
 await pg.exec(read('tests/fixtures/opportunity-schema.sql'));
 await pg.exec(read('tests/fixtures/owner-cleanup-ticket-recovery-native.sql'));
 let source=read('config/owner-enrichment-deferral.sql');
 await pg.exec(source.slice(0,source.indexOf('create function public.icash_defer_owner_enrichment'))+'commit;');
 source=read('config/owner-export-preflight.sql');
 await pg.exec(source.slice(0,source.indexOf('create function public.icash_claim_owner_preflight'))+'commit;');
 await pg.exec(read('tests/fixtures/owner-preflight-priority-foundation.sql'));
 for(const name of ['icash_research_private.owner_preflight_cohort(uuid,uuid)','public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)',
  'public.icash_enrichment_before_prospecting_budget(uuid)','public.icash_enrichment_before_provider_quota(uuid)','public.icash_enrichment_candidate(uuid)','public.icash_next_acquisition()'])await pg.exec(definitions[name]);
 await pg.exec(read('config/owner-preflight-priority.sql'));
 await pg.exec(`select fixture_preflight_seed(n,false,interval '6 minutes') from generate_series(1,20) n;
  create index icash_automation_account on icash_automation_tickets(account_id,created_at desc);
  insert into icash_automation_tickets(account_id,kind,state,created_at,expires_at)
  select d.account_id,'contacts',case when n%2=0 then 'complete' else 'held' end,now()-interval '1 day',now()+interval '1 hour'
  from icash_discovery_configs d cross join generate_series(1,500) n;
  analyze icash_automation_tickets;`);
 const definition=await v("select pg_get_functiondef('icash_next_acquisition()'::regprocedure)");
 const start=definition.indexOf('for c in select ')+9,end=definition.indexOf(' limit 5 for update of d skip locked loop',start);
 assert.ok(start>9&&end>start);
 const selection=definition.slice(start,end).replace('select d.* from','select d.account_id from');
 const before=(await q(selection)).rows,hash=await v("select md5(string_agg(to_jsonb(t)::text,',' order by id)) from icash_automation_tickets t");
 assert.equal(before.length,20);
 const migration=read('config/acquisition-active-ticket-index.sql');
 const versions=readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(x=>x.endsWith('_acquisition_active_ticket_index.sql'));
 assert.equal(versions.length,1);assert.equal(read('supabase/migrations/'+versions[0]),migration);
 await pg.exec(migration);await pg.exec('analyze icash_automation_tickets');
 assert.deepEqual((await q(selection)).rows,before);
 assert.equal(await v("select pg_get_functiondef('icash_next_acquisition()'::regprocedure)"),definition);
 assert.equal(await v("select md5(string_agg(to_jsonb(t)::text,',' order by id)) from icash_automation_tickets t"),hash);
 const plan=await v('explain(analyze,buffers,format json) '+selection);
 assert.ok(walk(plan[0].Plan).some(n=>n['Index Name']==='icash_automation_account_active'),'Original predicate must use active-state index');
 const account=before[0].account_id,another=before[1].account_id;
 for(const [state,created,expires,blocked] of [
  ['issued',"now()-interval '1 day'","now()+interval '1 minute'",true],
  ['issued','now()','now()',false],
  ['consumed',"now()-interval '4 minutes'","now()-interval '1 minute'",true],
  ['consumed',"now()-interval '5 minutes'","now()+interval '1 minute'",false],
  ['complete','now()',"now()+interval '1 minute'",false],
  ['held','now()',"now()+interval '1 minute'",false],
 ]){
  await pg.exec('begin');
  try{
   await q(`insert into icash_automation_tickets(account_id,kind,state,created_at,expires_at) values($1,'contacts',$2,${created},${expires})`,[account,state]);
   const selected=(await q(selection)).rows.map(r=>r.account_id);
   assert.equal(!selected.includes(account),blocked,[state,created,expires].join(' '));
   assert.ok(selected.includes(another));assert.equal(selected.length,20-Number(blocked));
  }finally{await pg.exec('rollback');}
 }
 await pg.exec('begin;set local plan_cache_mode=force_generic_plan;prepare current_accounts as '+selection);
 try{
  await q("insert into icash_automation_tickets(account_id,kind,state) values($1,'contacts','issued')",[account]);
  assert.ok(!(await q('execute current_accounts')).rows.some(r=>r.account_id===account));
  await q("update icash_automation_tickets set state='held' where account_id=$1 and state='issued'",[account]);
  assert.ok((await q('execute current_accounts')).rows.some(r=>r.account_id===account));
 }finally{await pg.exec('rollback');}
 assert.equal(await v("select md5(string_agg(to_jsonb(t)::text,',' order by id)) from icash_automation_tickets t"),hash);
 console.log('PASS acquisition ticket index: actual current scheduler selection, history preservation, exact expiry/consumption boundaries, account isolation and reused generic-plan state transitions.');
}finally{await pg.close();}
