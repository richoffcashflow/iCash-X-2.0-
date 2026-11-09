// Actual ranking and receipt functions; synthetic accounts and no providers.
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setupIndexingFixture,read} from './fixtures/owner-preflight-indexing-setup.mjs';
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const before=JSON.parse(read('tests/fixtures/preflight-receipt-ranking-before.json'));
const migration=read('config/preflight-receipt-ranking.sql');
const name=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_preflight_receipt_ranking.sql'));
assert.equal(migration,read('supabase/migrations/'+name));
const due=(c,old=false,screening=c.screening)=>v(`select public.icash_owner_preflight_due_at${old?'_before':''}($1,$2)`,[c.account,screening]);
const stamp=value=>value===null?null:new Date(value).toISOString();
async function parity(c,expected){const a=await due(c),b=await due(c,true);assert.equal(stamp(a),stamp(b));assert.equal(a!==null,expected);}
async function isolated(fn){await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}}
const evidence=c=>v(`select jsonb_build_object('ticket',to_jsonb(t),'preflight',to_jsonb(p),'wallet',to_jsonb(w))
 from icash_automation_tickets t,icash_research_private.owner_export_preflights p,icash_wallets w
 where t.id=$1 and p.id=$2 and w.account_id=$3`,[c.ticket,c.preflight,c.account]);
try{
 await setupIndexingFixture(pg);await pg.exec(read('config/owner-preflight-list-indexing.sql'));
 await pg.exec(`create function public.icash_dealmachine_capacity_available(integer,uuid) returns boolean language sql stable set search_path='' as $$select public.icash_dealmachine_capacity_available($1)$$;`);
 await pg.exec(before.definition);
 assert.equal(await v('select md5(pg_get_functiondef($1::regprocedure))',[before.signature]),before.checksum);
 await pg.exec(before.definition.replace('public.icash_owner_preflight_due_at(', 'public.icash_owner_preflight_due_at_before('));
 await pg.exec('create sequence public.fixture_receipt_checks');
 const proof=await v("select pg_get_functiondef('icash_research_private.owner_preflight_list_known(uuid,boolean)'::regprocedure)");
 assert(proof.includes('begin\n select * into p'));
 await pg.exec(proof.replace('begin\n select * into p',"begin\n perform nextval('public.fixture_receipt_checks');\n select * into p"));
 const ordinary=[];
 for(let n=1;n<=64;n++){
  const c=await v('select fixture_preflight_seed($1)',[n]);ordinary.push(c);
  await q("update icash_automation_tickets set state='complete',outcome='fixture_complete' where id=$1",[c.ticket]);
 }
 const eligible=await v('select fixture_preflight_seed(1001)'),ready=await v('select fixture_ready_seed(1002)');
 const saved=await evidence(eligible),readySaved=await evidence(ready),ordinarySaved=await evidence(ordinary[0]);
 const attributes=()=>v(`select jsonb_build_object('volatility',provolatile,'securityDefiner',prosecdef,'config',proconfig,'acl',proacl,'defaults',proargdefaults::text)
  from pg_proc where oid=$1::regprocedure`,[before.signature]);
 const originalAttributes=await attributes();
 await pg.exec('alter sequence fixture_receipt_checks restart');
 for(const c of ordinary)assert.equal(await due(c),null);
 const oldReads=await v('select last_value::int from fixture_receipt_checks');assert.equal(oldReads,64,'Old ranking validates irrelevant receipts before rejecting completed tickets');
 await pg.exec(migration);
 assert.deepEqual(await attributes(),originalAttributes);
 await pg.exec('alter sequence fixture_receipt_checks restart');
 for(const c of ordinary)assert.equal(await due(c),null);
 assert.equal(await v('select is_called from fixture_receipt_checks'),false,'No receipt validation without a matching due retry');
 await parity(eligible,true);await parity(ready,true);
 assert.equal(stamp(await due(eligible,false,null)),stamp(await due(eligible,true,null)),'Account ranking retains the same due time');
 assert.equal(await due(eligible,false,ordinary[0].screening),null,'Screening-specific ranking remains bound');
 const suffix=' select min(p.next_check_at) from due p';
 const current=await v('select pg_get_functiondef($1::regprocedure)',[before.signature]);
 assert.equal(current.slice(current.indexOf(suffix)),before.definition.slice(before.definition.indexOf(suffix)),'Every final source, quota, unknown-operation and cohort predicate remains byte-identical');
 const changes=[
  ["update icash_automation_tickets set kind='discovery' where id=$1",eligible.ticket],
  ["update icash_automation_tickets set state='issued' where id=$1",eligible.ticket],
  ["update icash_automation_tickets set outcome='unknown_provider_result' where id=$1",eligible.ticket],
  ['update icash_automation_tickets set owner_preview_deferrals=0 where id=$1',eligible.ticket],
  ['update icash_automation_tickets set owner_preview_deferrals=8 where id=$1',eligible.ticket],
  ["update icash_automation_tickets set owner_preview_retry_after=now()+interval '1 minute' where id=$1",eligible.ticket],
  ["update icash_automation_tickets set owner_preview_retry_until=now()-interval '1 second' where id=$1",eligible.ticket],
  ["update icash_automation_tickets set owner_preview_screening_hash=repeat('0',64) where id=$1",eligible.ticket],
  ["update icash_research_private.owner_export_preflights set state='checking' where id=$1",eligible.preflight],
  ["update icash_research_private.owner_export_preflights set created_at=now()-interval '31 minutes' where id=$1",eligible.preflight],
  ["update icash_research_private.owner_export_preflights set created_at=now()+interval '1 minute' where id=$1",eligible.preflight],
  ["update icash_research_private.owner_export_preflights set next_check_at=now()+interval '1 minute' where id=$1",eligible.preflight],
  ['update icash_research_private.owner_export_preflights set deleted_at=now() where id=$1',eligible.preflight],
  ['update icash_research_private.owner_export_preflights set cleanup_attempts=1 where id=$1',eligible.preflight],
  ["update icash_research_private.owner_export_preflights set receipts=jsonb_set(receipts,'{create,rawText}','\"malformed\"') where id=$1",eligible.preflight],
  ["update icash_research_private.owner_export_preflights set receipts=jsonb_set(receipts,'{create,httpStatus}','500') where id=$1",eligible.preflight],
  ['update icash_accounts set bot_paused=true where id=$1',eligible.account],
  ['update icash_wallets set reserved_cents=balance_cents where account_id=$1',eligible.account],
  ['update icash_discovery_configs set contacts_enabled=false where account_id=$1',eligible.account],
  ['update icash_operation_rates set enabled=false where id=$1',eligible.rate],
  ['update fixture_cleanup_policy set check_quota=false'],
  ["update icash_screening_jobs set snapshot=snapshot||'{\"propertyId\":\"changed\"}' where id=$1",eligible.screening],
  ["insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('other','owners:'||$1||':original','synthetic unknown receipt',null,'credits')",eligible.account+':'+eligible.screening],
 ];
 for(const [statement,arg] of changes)await isolated(async()=>{
  await pg.exec('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable');
  await q(statement,arg?[arg]:[]);await parity(eligible,false);
 });
 for(const change of ["checked_at=now()-interval '31 minutes'","checked_at=now()+interval '1 minute'","receipts=receipts-'eligible'"])
  await isolated(async()=>{await pg.exec('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable');await q(`update icash_research_private.owner_export_preflights set ${change} where id=$1`,[ready.preflight]);await parity(ready,false);});
 await isolated(async()=>{
  await q('update icash_automation_tickets set account_id=$1 where id=$2',[ordinary[0].account,eligible.ticket]);await parity(eligible,false);
 });
 for(const role of ['anon','authenticated'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,before.signature]),false);
 await pg.exec('set role service_role');assert.ok(await due(eligible));await pg.exec('reset role');
 assert.deepEqual(await evidence(eligible),saved);assert.deepEqual(await evidence(ready),readySaved);assert.deepEqual(await evidence(ordinary[0]),ordinarySaved);
 for(const table of ['icash_operation_spend','icash_credit_reservations','icash_cost_manifests','icash_credit_ledger'])assert.equal(await v(`select count(*)::int from ${table}`),0);
 await assert.rejects(pg.exec(migration),/Preflight receipt ranking prerequisite changed/);await pg.exec('rollback');
 assert.equal(await v('select pg_get_functiondef($1::regprocedure)',[before.signature]),current);
 console.log('PASS receipt ranking: 64 irrelevant proof reads -> 0; actual waiting/ready proof and due-time parity, retry bounds, tenant/source/unknown-receipt/Pause/funds/quota gates, unchanged evidence/private definer attributes and drift rejection. No providers.');
}finally{await pg.close();}
