// Offline PostgreSQL engine only. No credentials, providers, or live database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {processSellerIntake} from '../lib/seller-pipeline.ts';
import {processSellerResearchRefresh} from '../lib/seller-research-refresh.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),one=async(s,a=[])=>(await pg.query(s,a)).rows[0],val=async(s,a=[])=>Object.values(await one(s,a))[0];
try{
 await pg.exec(read('tests/fixtures/owner-demo-request-foundation.sql'));
 const refresh=read('config/seller-shared-research-refresh.sql');
 await pg.exec(refresh.slice(0,refresh.indexOf('-- Only a new'))+'commit;');
 await pg.exec(`create function icash_seller_research_refresh_targets(uuid) returns table(lead_id uuid) language sql as $$select id from public.icash_seller_intakes where state='assigned'$$;
 create table fixture_quota(allowed boolean,calls int);insert into fixture_quota values(true,0);
 create function icash_take_dealmachine_request() returns boolean language plpgsql as $$begin
 perform 1 from public.fixture_quota for update;
 if (select allowed from public.fixture_quota) is distinct from true then return false;end if;
 update public.fixture_quota set calls=calls+1;return true;end$$;`);
 await pg.exec(refresh.slice(refresh.indexOf('create function public.icash_claim_seller_research_refresh()'),refresh.indexOf('create function public.icash_finish_seller_research_refresh')));
 const meta=read('config/meta-instant-leads.sql');
 await pg.exec(meta.slice(meta.indexOf('create function public.icash_meta_claim_lookup('),meta.indexOf('-- New service-only entrypoints')));
 const original=await val("select pg_get_functiondef('icash_claim_seller_lookup_for(uuid)'::regprocedure)");
 const sql=read('config/seller-atomic-quota-admission.sql');assert.equal(sql,read('supabase/migrations/20261105131617_seller_atomic_quota_admission.sql'));await pg.exec(sql);
 assert.equal(await val("select pg_get_functiondef('icash_claim_seller_lookup_for(uuid)'::regprocedure)"),original,'old demo/Meta entrypoint untouched');
 for(const signature of ['icash_claim_seller_lookup_admitted_for(uuid)','icash_claim_seller_lookup_admitted()','icash_claim_seller_research_refresh_admitted()','icash_meta_claim_lookup_admitted(uuid)']){
  for(const role of ['anon','authenticated'])assert.equal(await val("select has_function_privilege($1,$2,'EXECUTE')",[role,signature]),false);
  assert.equal(await val("select has_function_privilege('service_role',$1,'EXECUTE')",[signature]),true);
 }

 const snapshot=()=>val(`select jsonb_build_object('quota',(select to_jsonb(q) from public.fixture_quota q),'controls',(select to_jsonb(c) from icash_seller_controls c),'leads',(select jsonb_agg(to_jsonb(l) order by id) from icash_seller_intakes l),'refresh',(select jsonb_agg(to_jsonb(f) order by id) from icash_seller_research_refreshes f))`);
 const fresh=async()=>{const id=randomUUID();await pg.query('select fixture_owner_demo_lead($1,$2)',[id,randomUUID()]);return id;};
 const claim=id=>val('select icash_claim_seller_lookup_admitted_for($1)',[id]);
 let count=0;
 const scenario=async(fn)=>{await pg.exec('begin');try{await fn();count++;}finally{await pg.exec('rollback');}};
 await scenario(async()=>{const before=await snapshot();for(let i=0;i<10;i++){assert.equal(await claim(null),null);assert.equal(await val('select icash_claim_seller_research_refresh_admitted()'),null);}assert.deepEqual(await snapshot(),before);});
 for(const gate of ['update icash_seller_controls set enabled=false','update icash_seller_controls set lookup_allowance_micros=0','update icash_operation_rates set enabled=false',"update icash_seller_intakes set state='review'"]){await scenario(async()=>{const id=await fresh();await pg.exec(gate);const before=await snapshot();assert.equal(await claim(id),null);assert.deepEqual(await snapshot(),before);});}
 await scenario(async()=>{const id=await fresh();await pg.exec('delete from icash_dealmachine_request_budget');const before=await snapshot();assert.deepEqual(await claim(id),{status:'admission_busy'});assert.deepEqual(await snapshot(),before);});
 await scenario(async()=>{const id=await fresh();await pg.exec('update public.fixture_quota set allowed=false');const before=await snapshot();assert.deepEqual(await claim(id),{status:'rate_limited'});assert.deepEqual(await snapshot(),before);});
 await scenario(async()=>{const id=await fresh(),c=await claim(id);assert.equal(c.id,id);assert.equal(await val('select calls from public.fixture_quota'),1);assert.equal(await val('select lookup_reserved_micros from icash_seller_controls'),16000);assert.equal(await claim(id),null);assert.equal(await val('select calls from public.fixture_quota'),1);});
 await scenario(async()=>{const id=await fresh();await pg.exec(`create function fixture_fail() returns trigger language plpgsql as $$begin raise exception 'injected post-quota failure';end$$;create trigger fixture_fail before update on icash_seller_controls for each row execute function fixture_fail();savepoint failed_claim;`);const before=await snapshot();await assert.rejects(claim(id),/injected post-quota failure/);await pg.exec('rollback to savepoint failed_claim');assert.deepEqual(await snapshot(),before,'quota and claim roll back together');});
 await scenario(async()=>{const old=await fresh(),id=await fresh();await pg.query("update icash_seller_intakes set state='checking',claimed_at=now()-interval '3 minutes',lookup_cap_micros=16000 where id=$1",[old]);await pg.exec('update icash_seller_controls set lookup_reserved_micros=16000;update public.fixture_quota set allowed=false');assert.deepEqual(await claim(id),{status:'rate_limited'});assert.equal(await val('select state from icash_seller_intakes where id=$1',[old]),'review');assert.equal(await val('select lookup_reserved_micros from icash_seller_controls'),16000);assert.equal(await val('select state from icash_seller_intakes where id=$1',[id]),'received');});
 for(const allowed of [true,false])await scenario(async()=>{const id=await fresh();await pg.query("update icash_seller_intakes set state='assigned',checked_at=now()-interval '25 hours',property=jsonb_build_object('fetchedAt',now()-interval '25 hours'),result='{}',data_rights_until=now()+interval '1 day' where id=$1",[id]);await pg.query('update public.fixture_quota set allowed=$1',[allowed]);const before=await snapshot(),c=await val('select icash_claim_seller_research_refresh_admitted()');if(!allowed){assert.deepEqual(c,{status:'rate_limited'});assert.deepEqual(await snapshot(),before);}else{assert(c.id);assert.equal(await val('select calls from public.fixture_quota'),1);assert.equal(await val('select count(*)::int from icash_seller_research_refreshes'),1);assert.equal(await val('select icash_claim_seller_research_refresh_admitted()'),null);assert.equal(await val('select calls from public.fixture_quota'),1);}});
 await assert.rejects(processSellerIntake(async()=>({status:'unexpected'}),'dm_sk_live_fixture',async()=>{throw Error('no provider');},randomUUID()),/SELLER_ADMISSION_INVALID/);

 // Exercise the actual production reserve limiter too. Its complete installation
 // prerequisite guard is covered independently by new-user-request-reserve.test.
 // Here the existing fixture has a deliberately instrumented legacy wrapper.
 await pg.exec('create table public.icash_funding_orders(account_id uuid,mode text,state text,credited_at timestamptz);');
 const reserve=read('config/new-user-request-reserve.sql');
 await pg.exec('begin;'+reserve.slice(reserve.indexOf('create table icash_research_private.request_reserve_policy')));
 await pg.exec('update icash_research_private.request_reserve_policy set enabled=true;');
 for(const [day,minute,allowed] of [[8819,0,true],[8820,0,false],[9800,0,false],[0,60,false]])await scenario(async()=>{
  const id=await fresh();await pg.query('update icash_dealmachine_request_budget set day_used=$1,minute_used=$2,minute_start=now()',[day,minute]);
  const before=await val('select to_jsonb(b) from icash_dealmachine_request_budget b'),c=await claim(id);
  if(allowed){assert.equal(c.id,id);assert.equal(await val('select day_used from icash_dealmachine_request_budget'),day+1);}
  else{assert.deepEqual(c,{status:'rate_limited'});assert.deepEqual(await val('select to_jsonb(b) from icash_dealmachine_request_budget b'),before);assert.equal(await val('select state from icash_seller_intakes where id=$1',[id]),'received');assert.equal(await val('select lookup_reserved_micros from icash_seller_controls'),0);}
  assert.equal(await val('select count(*)::int from icash_research_private.request_reserve_admissions'),0,'anonymous seller cannot consume starter slots');
 });
 await scenario(async()=>{await fresh();await pg.exec("update icash_dealmachine_request_budget set day_used=0;update icash_research_private.quota_feedback set blocked_until=now()+interval '1 hour'");assert.deepEqual(await claim(null),{status:'rate_limited'});assert.equal(await val('select day_used from icash_dealmachine_request_budget'),0);});
 await scenario(async()=>{await pg.exec('update icash_dealmachine_request_budget set day_used=0');const before=await snapshot();for(let i=0;i<10;i++)assert.equal(await claim(null),null);assert.deepEqual(await snapshot(),before);assert.equal(await val('select day_used from icash_dealmachine_request_budget'),0);});
 await scenario(async()=>{const id=await fresh();await pg.exec(`update icash_dealmachine_request_budget set day_used=0;create function fixture_real_fail() returns trigger language plpgsql as $$begin raise exception 'real quota rollback';end$$;create trigger fixture_real_fail before update on icash_seller_controls for each row execute function fixture_real_fail();savepoint real_failed_claim;`);const before=await val('select to_jsonb(b) from icash_dealmachine_request_budget b');await assert.rejects(claim(id),/real quota rollback/);await pg.exec('rollback to savepoint real_failed_claim');assert.deepEqual(await val('select to_jsonb(b) from icash_dealmachine_request_budget b'),before);assert.equal(await val('select state from icash_seller_intakes where id=$1',[id]),'received');});
 await scenario(async()=>{const id=await fresh();await pg.query("update icash_seller_intakes set state='assigned',checked_at=now()-interval '25 hours',property=jsonb_build_object('fetchedAt',now()-interval '25 hours'),result='{}',data_rights_until=now()+interval '1 day' where id=$1",[id]);await pg.exec('update icash_dealmachine_request_budget set day_used=8820');const before=await snapshot();assert.deepEqual(await val('select icash_claim_seller_research_refresh_admitted()'),{status:'rate_limited'});assert.deepEqual(await snapshot(),before);assert.equal(await val('select day_used from icash_dealmachine_request_budget'),8820);});
 await pg.exec(`alter table icash_meta_leads add account_id uuid,add screening_id uuid;
 create function icash_seller_contact_evidence(uuid,uuid,uuid,text) returns jsonb language sql as $$select '{"synthetic":"bound evidence"}'::jsonb$$;`);
 for(const paused of [false,true])await scenario(async()=>{const id=await fresh();await pg.exec('update icash_dealmachine_request_budget set day_used=0');await pg.query('update icash_accounts set bot_paused=$1',[paused]);await pg.query("insert into icash_meta_leads values($1,'48dfb798-8c1a-404f-88c0-c396cc067062',gen_random_uuid())",[id]);
  assert.equal(await claim(id),null,'ordinary path cannot claim Meta');
  const c=await val('select icash_meta_claim_lookup_admitted($1)',[id]);if(paused)assert.equal(c,null);else assert.equal(c.id,id);
  assert.equal(await val('select day_used from icash_dealmachine_request_budget'),paused?0:1);assert.equal(await val("select current_setting('icash.meta_lookup_lead',true)"),'');
 });
 let busyCalls=0;assert.equal((await processSellerIntake(async()=>{busyCalls++;return {status:'admission_busy'};},'dm_sk_live_fixture',async()=>{throw Error('no provider');},randomUUID())).status,'rate_limited');assert.equal(busyCalls,1,'quota contention must not invoke demo fallback');
 let calls=[];const transport=async()=>{throw Error('provider must never run');};
 for(const run of [processSellerIntake,processSellerResearchRefresh]){calls=[];assert.equal((await run(async(path)=>{calls.push(path);return null;},'dm_sk_live_fixture',transport)).status,'idle_or_setup_required');assert.equal(calls.length,1);assert.match(calls[0],/_admitted$/);}
 let demo=0;assert.equal((await processSellerIntake(async(path)=>{if(path==='rpc/icash_claim_owner_demo_lookup'){demo++;return null;}return null;},'dm_sk_live_fixture',transport,randomUUID())).status,'idle_or_setup_required');assert.equal(demo,0,'idle does not invoke exception');
 await assert.rejects(processSellerIntake(async()=>{throw Error('missing atomic RPC');},'dm_sk_live_fixture',transport),/missing atomic RPC/);

 // Migration rejects source drift before replacing any installed admitted RPC.
 const installed=await val("select pg_get_functiondef('icash_claim_seller_lookup_admitted_for(uuid)'::regprocedure)");
 await pg.exec(original.replace('-- An ambiguous lookup','-- Deliberately changed fixture\n -- An ambiguous lookup'));
 await assert.rejects(pg.exec(sql),/Seller atomic admission prerequisite changed/);
 await pg.exec('rollback');await pg.exec(original);
 assert.equal(await val("select pg_get_functiondef('icash_claim_seller_lookup_admitted_for(uuid)'::regprocedure)"),installed);
 console.log(`PASS ${count} atomic claim database scenarios; idle routing, missing-version fail-closed, and owner-demo isolation.`);
}finally{await pg.close();}
