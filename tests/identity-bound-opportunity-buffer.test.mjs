import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {setupIndexingFixture,read} from './fixtures/owner-preflight-indexing-setup.mjs';
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const captured=JSON.parse(read('tests/fixtures/identity-bound-buffer-before.json'));
const migration=read('config/identity-bound-opportunity-buffer.sql');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const isolate=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
let account,rate,first;
const count=()=>one('select icash_pending_opportunity_count($1)',[account]);
const due=()=>one('select icash_outbound_search_due($1)',[account]);
const inventory=()=>one(`select jsonb_build_object(
 'contacts',(select jsonb_agg(to_jsonb(c) order by screening_id) from icash_owner_contacts c),
 'operational',(select jsonb_agg(to_jsonb(c) order by screening_id,sending_principal) from icash_operational_contacts c),
 'spend',(select jsonb_agg(to_jsonb(c) order by operation_key) from icash_operation_spend c),
 'wallet',(select jsonb_agg(to_jsonb(c) order by account_id) from icash_wallets c),
 'tickets',(select jsonb_agg(to_jsonb(c) order by id) from icash_automation_tickets c),
 'permissions',(select jsonb_agg(to_jsonb(c) order by screening_id) from icash_contact_permissions c))`);
async function seed(n,kind='settled'){
 const screening=id(n),operation=`owners:${account}:${screening}`;
 await q(`insert into icash_screening_jobs(id,account_id,event_key,snapshot,state,result,created_at,completed_at)
 values($1,$2,$3,jsonb_build_object('propertyId',$4::text,'propertyType','house','fetchedAt',now(),
 'raw',jsonb_build_object('data',jsonb_build_object('dm_property_id',$4::text,'state','TX','zip','75217'))),'complete','{"financialCheck":{"status":"eligible"}}',now(),now())`,[screening,account,'buffer-'+n,'prop_'+n]);
 if(kind==='held')await q("insert into icash_automation_tickets(account_id,kind,screening_id,state,outcome) values($1,'contacts',$2,'held','held')",[account,screening]);
 else{
  await q(`insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until,dispatched_at,settled_at)
   values($1,$2,$3,$4,105,100000,$5,now()+interval '1 day',now(),case when $5='settled' then now() else null end)`,[operation,account,rate,id(n+10000),kind]);
  if(kind==='settled'){
   await q(`insert into icash_owner_contacts(screening_id,account_id,operation_key,result) values($1,$2,$3,
    jsonb_build_object('propertyId',$4::text,'contacts',jsonb_build_array(jsonb_build_object('likelyOwner',true,'phones',jsonb_build_array(jsonb_build_object('number','+12145550101','doNotCall',false))))))`,[screening,account,operation,'prop_'+n]);
   await q(`insert into icash_operational_contacts(account_id,screening_id,source_hash,sending_principal)
    select account_id,screening_id,encode(sha256(convert_to(result::text,'UTF8')),'hex'),'Previous Buyer' from icash_owner_contacts where screening_id=$1`,[screening]);
  }
 }
 return screening;
}
try{
 await setupIndexingFixture(pg);
 await pg.exec(read('config/owner-retry-fair-priority.sql'));
 await pg.exec(`create table icash_customer_identities(account_id uuid primary key,principal text not null);
 grant select on icash_customer_identities to service_role;
 alter table icash_operational_contacts add column source_hash text,add column sending_principal text;
 alter table icash_contact_permissions add column revoked_at timestamptz,add column permission_until timestamptz;
 create function icash_research_zip_known(text) returns boolean language sql stable as $$select $1='75217'$$;`);
 const outcomes=read('config/opportunity-engine.sql');await pg.exec(outcomes.slice(0,outcomes.indexOf('create function public.icash_call_has_seller_response'))+'commit;');
 for(const f of captured.functions){await pg.exec(f.definition);assert.equal(await one('select md5(pg_get_functiondef($1::regprocedure))',[f.signature]),f.hash);}
 const c=await one("select fixture_preflight_seed(80000,false)");account=c.account;rate=c.rate;
 await q('delete from icash_screening_jobs where account_id=$1',[account]);
 await q("insert into icash_customer_identities values($1,'Current Buyer')",[account]);
 await q(`insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled)
 values($1,'property_search','buffer-search',105,'{"dealmachine":250000}','SYNTHETIC search rate',now()-interval '1 day',now()+interval '1 day',true)`,[id(90000)]);
 await q('update icash_discovery_configs set rate_id=$2,max_open_prospects=25 where account_id=$1',[account,id(90000)]);
 await pg.exec("insert into icash_acquisition_policy(id,mode) values(1,'outbound');");
 for(let n=1;n<=19;n++){const s=await seed(n);if(n===1)first=s;}
 for(let n=20;n<=26;n++)await seed(n,'dispatched');
 for(let n=27;n<=29;n++)await seed(n,'held');
 assert.equal(await count(),29);assert.equal(await due(),false,'Reproduce unusable old-identity contacts filling the pipeline');
 const before=await inventory(),oldDefinition=await one("select pg_get_functiondef('icash_pending_opportunity_count(uuid)'::regprocedure)");
 await pg.exec('revoke all on function icash_pending_opportunity_count(uuid) from public,anon,authenticated;grant execute on function icash_pending_opportunity_count(uuid) to service_role;');
 const acl=await one("select proacl::text from pg_proc where oid='icash_pending_opportunity_count(uuid)'::regprocedure");
 await pg.exec(migration);
 const definition=await one("select pg_get_functiondef('icash_pending_opportunity_count(uuid)'::regprocedure)");
 assert.equal(definition.replace(migration.split('$new$')[1],migration.match(/needle:='([^']+)';/)[1]),oldDefinition,'Only the narrow buffer projection changes');
 assert.equal(await one("select proacl::text from pg_proc where oid='icash_pending_opportunity_count(uuid)'::regprocedure"),acl);
 assert.equal(await count(),10);assert.equal(await due(),true);
 await pg.exec('set role service_role;begin read only');
 try{assert.equal(await count(),10);}finally{await pg.exec('rollback;reset role');}
 for(const f of captured.functions.filter(f=>f.signature!=='icash_pending_opportunity_count(uuid)'))
  assert.equal(await one('select pg_get_functiondef($1::regprocedure)',[f.signature]),f.definition,'Existing research admission stays exact');
 assert.equal(await one('select icash_enrichment_before_prospecting_budget($1)',[account]),null,'Old properties remain fenced from repeated enrichment');
 assert.equal(await one("select count(*)::int from icash_operation_spend where state='dispatched'"),7,'Unknown purchases remain held');
 assert.deepEqual(await inventory(),before,'Projection changes no contact, purchase, wallet, ticket or permission');
 const cases=[
  ["insert into icash_operational_contacts select account_id,screening_id,source_hash,'Current Buyer' from icash_operational_contacts where screening_id=$1"],
  ["insert into icash_contact_permissions(account_id,screening_id,permission_until) values('"+account+"',$1,now()+interval '1 hour')"],
  ["update icash_owner_contacts set result=result||'{\"changed\":true}' where screening_id=$1"],
  ["delete from icash_operational_contacts where screening_id=$1"],
  ["update icash_operational_contacts set sending_principal='' where screening_id=$1"],
  ["update icash_operational_contacts set account_id='"+id(99999)+"' where screening_id=$1"],
  ["update icash_operation_spend set state='dispatched',settled_at=null where operation_key='owners:'||'"+account+"'||':'||$1::text"],
  ["update icash_operation_spend set settled_at=null where operation_key='owners:'||'"+account+"'||':'||$1::text"],
 ];
 for(const [sql] of cases)await isolate(async()=>{await q(sql,[first]);assert.equal(await count(),11,'Alternative route or uncertainty retains its buffer slot');});
 await isolate(async()=>{await q("update icash_customer_identities set principal='Previous Buyer' where account_id=$1",[account]);assert.equal(await count(),29,'Restored exact identity restores its original inventory');});
 await isolate(async()=>{await q("update icash_customer_identities set principal='' where account_id=$1",[account]);assert.equal(await count(),29,'Missing identity is not permission to buy new work');});
 await isolate(async()=>{await q('delete from icash_customer_identities where account_id=$1',[account]);assert.equal(await count(),29);});
 await isolate(async()=>{const prior=await seed(30,'dispatched');await q('update icash_screening_jobs set snapshot=jsonb_set(snapshot,\'{propertyId}\',\'"prop_1"\') where id=$1',[prior]);assert.equal(await count(),12,'Unknown same-property purchase preserves both old and current slots');});
 await isolate(async()=>{await q("update icash_screening_jobs set state='queued' where id=$1",[first]);assert.equal(await count(),11,'Queued screening remains pending even with old contact history');});
 for(const sql of ["update icash_accounts set bot_paused=true","update fixture_cleanup_policy set member=false","update icash_wallets set balance_cents=0","update icash_wallets set reserved_cents=balance_cents","update fixture_cleanup_policy set quota=false","update icash_discovery_configs set data_rights_until=now()-interval '1 second'"])
  await isolate(async()=>{await pg.exec(sql);assert.equal(await due(),false,sql);});
 await isolate(async()=>{const token=await one('select icash_next_acquisition()');assert(token?.token);assert.equal(await one("select kind from icash_automation_tickets where token=$1",[token.token]),'discovery','Normal scheduler selects only independent new research');});
 assert.deepEqual(await inventory(),before);
 assert.equal(await one("select provolatile::text||':'||prosecdef::text from pg_proc where oid='icash_pending_opportunity_count(uuid)'::regprocedure"),'s:false');
 assert.equal(migration,read('supabase/migrations/20261103183400_identity_bound_opportunity_buffer.sql'));
 console.log('PASS identity-bound buffer: reproduced29 blocked slots→10, seven original unknowns retained, exact old-source scope, current/legacy alternatives, same-property uncertainty, unchanged money/records, ordinary controls and independent scheduler admission. Offline only.');
}finally{await pg.close();}
