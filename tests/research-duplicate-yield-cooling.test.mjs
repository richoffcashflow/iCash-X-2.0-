import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {discoveryStrategies,selectDiscoveryFilter} from '../lib/discovery-filters.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('_research_duplicate_yield_cooling.sql'));
assert.equal(migration.length,1);
const sql=read('config/research-duplicate-yield-cooling.sql');
assert.equal(sql,read('supabase/migrations/'+migration[0]));
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),revision=id(2),policy={version:'research-efficiency-v2',exclusionListId:null};
const stats=discoveryStrategies.map(strategy=>({strategy,nextPage:1,exhausted:false,blocked:false,pages:0,attempted:0,matureAttempts:0,pendingAttempts:0,interested:0,optedOut:0,costCents:0,costsComplete:true,recentUnproductivePages:0}));
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_discovery_configs(account_id uuid primary key,revision uuid,next_page integer,zip text,per_page integer,research_version integer,research_list_id text);
 create table icash_discovery_filter_pages(operation_key text primary key,account_id uuid,zip text,plan jsonb,state text,created_at timestamptz);
 create table icash_discovery_inventory_receipts(operation_key text primary key,account_id uuid,zip text,strategy text,per_page integer,query_policy jsonb,returned_properties integer,queued_properties integer,duplicate_properties integer,created_at timestamptz);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,state text,actual_micros bigint,charged_cents bigint);
 create table fixture_state(value jsonb);
 create function icash_discovery_filter_state_v2(uuid,uuid,integer) returns jsonb language sql as $$select value from public.fixture_state$$;
 `);
 await q('insert into fixture_state values($1)',[stats]);
 await q("insert into icash_discovery_configs values($1,$2,1,'75217',25,2,null)",[account,revision]);
 await db.exec(read('config/research-market-duplicate-cooling.sql'));
 const signature='public.icash_market_duplicate_supply(text,text,integer,jsonb)';
 const original=await v('select pg_get_functiondef($1::regprocedure)',[signature]);
 const metadata=()=>v('select jsonb_build_object(\'acl\',proacl,\'securityDefiner\',prosecdef,\'volatility\',provolatile,\'config\',proconfig) from pg_proc where oid=$1::regprocedure',[signature]);
 const beforeMetadata=await metadata();
 const cool=(size=25)=>v("select icash_market_duplicate_supply('75217','baseline',$1,$2)",[size,policy]);
 const add=async(n,{queued=1,duplicates=24,returned=25,size=25,age=100-n,actual=10000,charged=3,state='settled',pageState='complete',receipt=true,zip='75217',strategy='baseline',queryPolicy=policy}={})=>{
  const owner=id(n+20),key=`page-${n}`;
  await q("insert into icash_discovery_filter_pages values($1,$2,$3,$4,$5,now()-$6*interval '1 minute')",[key,owner,zip,{version:'seller-filters-v1',strategy,providerPage:n,mode:'explore'},pageState,age]);
  await q('insert into icash_operation_spend values($1,$2,$3,$4,$5)',[key,owner,state,actual,charged]);
  if(receipt)await q("insert into icash_discovery_inventory_receipts values($1,$2,$3,$4,$5,$6,$7,$8,$9,now()-$10*interval '1 minute')",[key,owner,zip,strategy,size,queryPolicy,returned,queued,duplicates,age]);
 };
 await add(1);await add(2,{queued:2,duplicates:23});await add(3,{queued:5,duplicates:20});
 assert.equal(await cool(),false,'Reproduce the old rule: one fresh property prevents any shared cooling');
 // Unknown predecessor changes must stop installation, without partial changes.
 await db.exec(original.replace('limit 3','limit 4'));
 await assert.rejects(db.exec(sql),/Duplicate supply prerequisite changed/);await db.exec('rollback');
 await db.exec(original);
 await db.exec(sql);
 assert.deepEqual(await metadata(),beforeMetadata,'Read-only volatility, invoker permissions and private ACL remain identical');
 assert.equal(await cool(),true,'Three independently confirmed pages with 1, 2 and 5 fresh records cool this audience');
 const state=await v('select icash_discovery_filter_state_v2($1,$2,1)',[account,revision]);
 assert.equal(state[0].recentUnproductivePages,3);
 assert.deepEqual(state.slice(1),stats.slice(1));
 let probes=0;for(let sequence=1;sequence<=50;sequence++)if(selectDiscoveryFilter(state,sequence).strategy==='baseline'){probes++;assert.equal(sequence%5,4);}
 assert.equal(probes,10,'Known low yield still receives the existing one-in-five probe slots');
 const baseline=await v('select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s');
 for(const [options,label] of [
  [{queued:6,duplicates:19},'A productive newer page immediately ends the streak, regardless of older poor pages'],
  [{actual:null},'Unknown cost cannot cool an audience'],
  [{charged:null},'Unknown settlement cannot cool an audience'],
  [{state:'dispatched'},'Pending financial holds stay authoritative'],
  [{pageState:'claimed',receipt:false},'A newer unfinished attempt breaks the streak before joining receipts'],
  [{size:5},'Different page sizes cannot contaminate the evidence'],
  [{queryPolicy:{...policy,version:'research-efficiency-v1'}},'Different query identities cannot contaminate the evidence'],
  [{queryPolicy:{...policy,exclusionListId:'mutable-list'}},'Mutable list queries remain excluded'],
  [{queued:2,duplicates:24},'Counts must reconcile to the actual returned rows'],
  [{queued:-1,duplicates:26},'Malformed negative counts are not evidence'],
  [{queued:0,duplicates:0,returned:0},'Empty data is not duplicate evidence'],
 ]){
  await db.exec('begin');await add(4,options);assert.equal(await cool(),false,label);await db.exec('rollback');
  assert.equal(await cool(),true);
 }
 await db.exec('begin');
 await q("update icash_discovery_inventory_receipts set account_id=$1 where operation_key='page-3'",[account]);
 assert.equal(await cool(),false,'Exact original account binding is required');await db.exec('rollback');
 await db.exec('begin');
 await q("update icash_discovery_inventory_receipts set created_at=now()-interval '25 hours' where operation_key='page-3'");
 assert.equal(await cool(),false,'Old evidence expires');await db.exec('rollback');
 await db.exec('begin');
 await q("update icash_discovery_inventory_receipts set created_at=now()+interval '1 minute' where operation_key='page-3'");
 assert.equal(await cool(),false,'Future receipt timestamps cannot qualify');await db.exec('rollback');
 await add(4,{zip:'10001'});await add(5,{strategy:'vacant'});assert.equal(await cool(),true,'Unrelated markets remain independent');
 await db.exec('begin');
 await q('update icash_discovery_inventory_receipts set per_page=5,returned_properties=5,queued_properties=1,duplicate_properties=4');
 assert.equal(await cool(5),true,'Budget-sized pages use the same proportion without rounding');await db.exec('rollback');
 await db.exec('begin');
 await q('update icash_discovery_inventory_receipts set queued_properties=0,duplicate_properties=returned_properties');
 await q('update icash_operation_spend set actual_micros=0,charged_cents=0');
 assert.equal(await cool(),true,'Original wholly duplicate zero-cost pages still qualify');await db.exec('rollback');
 assert.deepEqual(await v("select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s where operation_key in ('page-1','page-2','page-3')"),baseline,'Selection leaves original financial evidence unchanged');
 assert(selectDiscoveryFilter(stats.map(s=>({...s,recentUnproductivePages:3})),1),'All-cooled markets retain fallback work');
 assert.equal(selectDiscoveryFilter(stats.map(s=>({...s,recentUnproductivePages:3,exhausted:s.strategy!=='baseline'})),1).strategy,'baseline','A sole available audience is not stalled');
 assert.notEqual(selectDiscoveryFilter(state.map(s=>({...s,blocked:s.strategy==='baseline'})),4).strategy,'baseline','Probes never bypass unknown-operation fences');
 for(const role of ['anon','authenticated'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 assert.equal(await v('select has_function_privilege(\'service_role\',$1,\'execute\')',[signature]),true);
 console.log('PASS duplicate yield cooling: reproduced waste, conservative source/settlement gates, productive recovery, probes, fallback, immutable evidence and private access.');
}finally{await db.close();}
