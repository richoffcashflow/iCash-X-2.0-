import assert from 'node:assert/strict';
import {installContinuedHandlerFixture,seedHandlerOriginal,value,read} from './continued-owner-handler-fixture.mjs';
export {value,read,seedHandlerOriginal};
export const signature='public.icash_owner_batch_candidates(uuid,uuid)';
export const captured=JSON.parse(read('tests/fixtures/owner-batch-pool-before.json'));
export const migration=read('config/owner-batch-pool-selection.sql');
export async function installOwnerPoolFixture(pg){
 await installContinuedHandlerFixture(pg);
 await pg.exec('begin;'+read('config/continued-owner-cohort-handoff.sql')+'commit;');
 // Actual pool resolver and its indexed source relations; no provider calls.
 await pg.exec(`create table public.icash_discovery_filter_pages(operation_key text primary key,account_id uuid not null,plan jsonb not null);
 create table public.icash_discovery_filter_attribution(screening_id uuid primary key,operation_key text not null,account_id uuid not null);
 create index icash_discovery_filter_attribution_account on public.icash_discovery_filter_attribution(account_id,screening_id);
 create index icash_screening_account on public.icash_screening_jobs(account_id,created_at desc);
 create index icash_screening_property_account on public.icash_screening_jobs((snapshot->>'propertyId'),account_id) include(id);`);
 for(const entry of captured){
  if(entry.signature.includes('icash_owner_targeting_pool(')||entry.signature.includes('icash_owner_active_export_enabled('))await pg.exec(entry.definition);
  assert.equal(await value(pg,'select md5(pg_get_functiondef($1::regprocedure))',[entry.signature]),entry.md5,'Exact captured predecessor: '+entry.signature);
 }
}
export const candidates=(pg,c)=>value(pg,'select public.icash_owner_batch_candidates($1,$2)',[c.account,c.screening]);
export async function seedMixedPool(pg,n,{mobile=false,matching=6,opposite=4}={}){
 const c=await value(pg,'select public.fixture_preflight_seed($1,false)',[n]);
 await pg.query('delete from public.icash_screening_jobs where id=$1',[c.fresh]);
 const snapshot=await value(pg,'select snapshot from public.icash_screening_jobs where id=$1',[c.screening]);
 const ids=[];
 for(let i=0;i<opposite+matching;i++){
  const id=`00000000-0000-4000-8000-${String(n*100+i).padStart(12,'0')}`;
  const property='prop_'+(n*100+i);
  const source={...snapshot,propertyId:property,raw:{data:{...snapshot.raw.data,dm_property_id:property}}};
  await pg.query(`insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
   values($1,$2,$3,$4,'complete','{"financialCheck":{"status":"eligible"}}',now()-interval '1 hour')`,[id,c.account,'synthetic-pool-'+n+'-'+i,source]);
  ids.push(id);
 }
 const mobileIds=mobile?[c.screening,...ids.slice(opposite)]:ids.slice(0,opposite);
 const page='synthetic-pool-page-'+n;
 await pg.query(`insert into public.icash_discovery_filter_pages values($1,$2,'{"version":"seller-targeting-v1","targeting":{"segment":"mobile"}}')`,[page,c.account]);
 for(const id of mobileIds)await pg.query('insert into public.icash_discovery_filter_attribution values($1,$2,$3)',[id,page,c.account]);
 return {...c,matching:ids.slice(opposite),opposite:ids.slice(0,opposite)};
}
export const sourceCatalog=async pg=>Object.fromEntries((await pg.query(`select p.oid::regprocedure::text signature,
 pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,p.proacl::text acl
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in('public','icash_research_private','icash_work_private') and p.prokind='f' order by 1`)).rows.map(row=>[row.signature,row]));
export const policy=pg=>value(pg,'select to_jsonb(p) from icash_work_private.continuation_policy p where id=1');
export const history=async pg=>{
 const rows={};
 for(const table of [
 'public.icash_automation_tickets','public.icash_wallets','public.icash_operation_spend','public.icash_credit_reservations',
 'public.icash_operating_budget','public.icash_dealmachine_request_budget','icash_research_private.owner_export_settings',
 'icash_research_private.owner_export_preflights','icash_research_private.requests',
 'icash_research_private.expired_preflight_ticket_continuations','icash_work_private.continuation_decisions',
 ])rows[table]=await value(pg,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t`);
 return rows;
};
