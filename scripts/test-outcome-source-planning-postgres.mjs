// Native regression for the source planner under skewed account cardinalities.
// Runs only against the fixed disposable local database; no paid operations.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',connectionTimeoutMillis:5000});await c.connect();
const account='00000000-0000-4000-8000-000000000003',revision='00000000-0000-4000-8000-000000000099';
try{
 await assertDisposablePostgresTarget(c);
 await import('./test-outcome-cost-scale-postgres.mjs');
 assert(!process.exitCode,'The native source and collector fixture must pass before planner measurements');
 await c.query("set statement_timeout='20s';set track_functions='all';set jit=off;");
 console.log('JIT', (await c.query('select pg_jit_available() available')).rows);
 await c.query(`
 insert into icash_screening_jobs(id,account_id,event_key,snapshot,created_at) select md5('perf-screen-'||n)::uuid,'${account}','perf-source-'||n,jsonb_build_object('propertyId','perf-'||n,'raw',repeat('original-property-data ',100)),now()-interval '90 days' from generate_series(501,2691)n;
 insert into icash_contact_permissions(id,account_id,screening_id,party) select md5('perf-permission-'||n)::uuid,'${account}',md5('perf-screen-'||n)::uuid,'seller' from generate_series(1,725)n;
 insert into icash_operational_contacts(id,account_id,screening_id) select md5('perf-operational-'||n)::uuid,'${account}',md5('perf-screen-'||n)::uuid from generate_series(1,725)n;
 insert into icash_voice_jobs(id,account_id,permission_id,operational_contact_id,operation_key,state,created_at) select md5('perf-voice-job-'||n)::uuid,'${account}',md5('perf-permission-'||n)::uuid,md5('perf-operational-'||n)::uuid,'voice:'||md5('perf-call-'||n)::uuid,'dispatched',now()-interval '70 days' from generate_series(1,725)n;
 create index realistic_permission_id on icash_contact_permissions(id);create index realistic_operational_id on icash_operational_contacts(id);create index realistic_voice_account on icash_voice_jobs(account_id);
 create unique index realistic_owner_screen on icash_owner_contacts(screening_id);
 create index realistic_owner_account on icash_owner_contacts(account_id,created_at);
 create unique index realistic_batch_id on icash_research_private.owner_batches(id);
 create unique index realistic_batch_item_screen on icash_research_private.owner_batch_items(screening_id);
 create index realistic_batch_members on icash_research_private.owner_batch_items(batch_id);
 create unique index realistic_inventory_key on icash_discovery_inventory_receipts(operation_key);
 create index realistic_inventory_account on icash_discovery_inventory_receipts(account_id);
 create unique index realistic_result_key on icash_discovery_results(operation_key);
 create index realistic_result_account on icash_discovery_results(account_id);
 create index realistic_attr_op on icash_discovery_filter_attribution(operation_key,account_id);
 create index realistic_attr_account on icash_discovery_filter_attribution(account_id,screening_id);
 create index realistic_requests_account on icash_research_private.requests(account_id,created_at);
 create index realistic_requests_operation on icash_research_private.requests(operation_key,kind) where admitted and operation_key is not null;
 insert into icash_owner_contacts(screening_id,account_id,operation_key,result,created_at)
 select md5('perf-screen-'||n)::uuid,'${account}','owners:${account}:'||md5('perf-screen-'||n)::uuid,
 jsonb_build_object('propertyId','perf-'||n,'fetchedAt',to_char(now()-interval '71 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'requestedPersonIds',jsonb_build_array('per_A'||n,'per_B'||n),'contacts',(select jsonb_agg(jsonb_build_object('personId','per_'||p||n,'likelyOwner',true,'ownershipVerified',false,'outreachAuthorized',false,'phones',jsonb_build_array(jsonb_build_object('number','2125550100','permission','unverified'))))from unnest(array['A','B'])p),
 'providerCredits',jsonb_build_object('used',2,'people',2,'properties',0,'deduplicated',0),'creditsUsed',2,'peopleCredits',2,'outreachAuthorized',false,
 'allocation',jsonb_build_object('batchId',md5('perf-batch-'||((n-1)/5))::uuid,'method','unique-person-order-v1','sharedContacts',0)),now()-interval '70 days'
 from generate_series(1,768)n;
 insert into icash_research_private.owner_batches(id,account_id,primary_screening,created_at,state,items,preview_receipt,paid_receipt,results)
 select md5('perf-batch-'||((n-1)/5))::uuid,'${account}',min(c.screening_id::text)::uuid,now()-interval '71 days','complete',
 jsonb_agg(jsonb_build_object('screeningId',c.screening_id,'snapshot',jsonb_build_object('propertyId','perf-'||n),'ids',c.result->'requestedPersonIds')),
 '{}','{"credits":{"used":10,"people":10,"properties":0,"deduplicated":0}}',jsonb_agg(jsonb_build_object('screeningId',c.screening_id,'result',c.result))
 from generate_series(1,768)n join icash_owner_contacts c on c.screening_id=md5('perf-screen-'||n)::uuid group by ((n-1)/5);
 insert into icash_research_private.owner_batch_items select md5('perf-screen-'||n)::uuid,md5('perf-batch-'||((n-1)/5))::uuid,'owners:${account}:'||md5('perf-screen-'||n)::uuid from generate_series(1,768)n;
 update icash_screening_jobs s set event_key='discovery:${account}:${revision}:'||((n-1)/8+1)||':perf-'||n from generate_series(1,1640)n where s.id=md5('perf-screen-'||n)::uuid;
 insert into icash_discovery_inventory_receipts select 'discovery:${account}:${revision}:'||((n-1)/8+1),'${account}',array_agg('perf-'||n order by n),8,now()-interval '72 days' from generate_series(1,1640)n group by ((n-1)/8);
 insert into icash_discovery_results select 'discovery:${account}:${revision}:'||((n-1)/8+1),'${account}',jsonb_build_object('rows',jsonb_agg(jsonb_build_object('dm_property_id','perf-'||n,'description',repeat('saved property field ',100)))),now()-interval '72 days' from generate_series(1,1640)n group by ((n-1)/8);
 insert into icash_discovery_filter_attribution select md5('perf-screen-'||n)::uuid,'${account}','discovery:${account}:${revision}:'||((n-1)/8+1) from generate_series(1,1640)n;
 analyze;
 `);

 await c.query(`insert into icash_accounts(id,owner_user_id) select md5('light-account-'||n)::uuid,md5('light-user-'||n)::uuid from generate_series(1,599)n;
 insert into icash_screening_jobs(id,account_id,event_key,snapshot,created_at) select md5('light-screen-'||n)::uuid,md5('light-account-'||n)::uuid,'light-source-'||n,jsonb_build_object('propertyId','light-'||n),now() from generate_series(1,599)n; analyze;`);
 const read=n=>readFileSync(new URL('../config/'+n+'.sql',import.meta.url),'utf8');
 const oldSql=read('outcome-cost-sources');
 const newSql=read('outcome-cost-source-planning');
 const original=oldSql.match(/as \$function\$([\s\S]*?)\$function\$/)[1];
 const dynamic=newSql.match(/execute \$source\$([\s\S]*?)\$source\$ using p_account/)[1];
 assert.equal(dynamic,original.replaceAll('p_account','$1'));
 const timed=async(label,sql)=>{
  const start=performance.now();try{const result=(await c.query(sql,[account])).rows[0];console.log(JSON.stringify({label,ms:Math.round(performance.now()-start),result}));return result;}
  catch(e){
   if(e.code!=='57014')throw e;
   console.log(JSON.stringify({label,ms:Math.round(performance.now()-start),error:e.message}));return null;
  }
 };
 // Deliberately restore the original function only inside this isolated fixture.
 // The installed migration stays immutable; production uses its forward repair.
 await c.query(oldSql.replace('create function icash_learning_private.outcome_cost_sources', 'create or replace function icash_learning_private.outcome_cost_sources'));
 const oldCount=await timed('old_sql_generic_600_accounts', 'select count(*)::int rows from icash_learning_private.outcome_cost_sources($1)');
 await timed('old_sql_generic_full_materialize', 'create temporary table baseline as select * from icash_learning_private.outcome_cost_sources($1)');
 await c.query(newSql);
 const newCount=await timed('dynamic_typed_account_600_accounts', 'select count(*)::int rows from icash_learning_private.outcome_cost_sources($1)');
 assert.equal(newCount?.rows,4633,'All original sources remain represented');
 if(oldCount)assert.deepEqual(newCount,oldCount);
 const baseline=(await c.query("select to_regclass('pg_temp.baseline') is not null present")).rows[0].present;
 if(baseline){const eq=await timed('multiset_equivalence',`select count(*)::int differences from ((select * from baseline except all select * from icash_learning_private.outcome_cost_sources($1)) union all (select * from icash_learning_private.outcome_cost_sources($1) except all select * from baseline))d`);assert.equal(eq?.differences,0);}
 else {const literal=original.replaceAll('p_account',`'${account}'::uuid`);await c.query('create temporary table baseline as '+literal);const eq=await timed('literal_original_multiset_equivalence',`select count(*)::int differences from ((select * from baseline except all select * from icash_learning_private.outcome_cost_sources($1)) union all (select * from icash_learning_private.outcome_cost_sources($1) except all select * from baseline))d`);assert.equal(eq?.differences,0);}
 const routine=(await c.query("select l.lanname,p.provolatile,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='icash_learning_private.outcome_cost_sources(uuid)'::regprocedure")).rows[0];
 assert.deepEqual([routine.lanname,routine.provolatile,routine.prosecdef,routine.proconfig],['plpgsql','s',true,['search_path=""']]);
 assert.equal(routine.proacl,'{postgres=X/postgres,service_role=X/postgres}');
 for(const role of ['anon','authenticated'])assert.equal((await c.query("select has_function_privilege($1,'icash_learning_private.outcome_cost_sources(uuid)','execute') allowed",[role])).rows[0].allowed,false);
 assert.equal((await c.query("select has_function_privilege('service_role','icash_learning_private.outcome_cost_sources(uuid)','execute') allowed")).rows[0].allowed,true);
 console.log('PASS native source planning: 599 light accounts plus 2,691-screening heavy account; exact original source multiset, immutable forward source guard and private execution preserved. Timings are local measurements, not production latency guarantees.');
}catch(e){console.error('FAIL native source planning:',e.message,e.where??'');process.exitCode=1;}
finally{await c.end();}
