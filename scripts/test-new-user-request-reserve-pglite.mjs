// Actual production limiter definitions and reserve migration in isolated SQL.
// No network, provider calls, customer charges or test credit mutations.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const part=(file,start,end)=>{const s=read(file),a=s.indexOf(start),b=s.indexOf(end,a+start.length);assert(a>=0&&b>a);return s.slice(a,b);};

export async function installReservePrerequisites(pg){
 await pg.exec(read('tests/fixtures/new-user-request-reserve-foundation.sql'));
 const bridge='supabase/migrations/20260928221806_discovery_screening_bridge.sql';
 await pg.exec(part(bridge,'create table public.icash_dealmachine_request_budget','insert into public.icash_dealmachine_request_budget'));
 await pg.exec("insert into icash_dealmachine_request_budget(id) values(1);alter table icash_dealmachine_request_budget drop constraint icash_dealmachine_request_budget_day_limit_check;update icash_dealmachine_request_budget set minute_limit=60,day_limit=9800;");
 await pg.exec(part(bridge,'create function public.icash_take_dealmachine_request()','create function public.icash_save_discovery'));
 await pg.exec(part('config/research-request-efficiency.sql','create table icash_research_private.requests(','alter table icash_research_private.settings'));
 await pg.exec(part('config/research-request-efficiency.sql','create function public.icash_take_dealmachine_request(p_kind','create table icash_research_private.exclusions'));
 await pg.exec(part('config/provider-quota-scheduling.sql','create function public.icash_dealmachine_capacity_available','alter function public.icash_outbound_search_due'));
 await pg.exec(read('config/research-provider-feedback.sql'));
}

export async function testNewUserRequestReserve(){
 const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
 const uid=n=>`00000000-0000-4000-9000-${String(n).padStart(12,'0')}`;
 let id=100000;
 const claim=(account=null,kind='owner_preview',request=uid(id++),operation='starter:fixture')=>v('select icash_take_dealmachine_request($1,$2,$3,$4)',[kind,account,operation,request]);
 const cap=(n=1,a=null)=>v('select icash_dealmachine_capacity_available($1,$2)',[n,a]);
 const state=()=>v('select icash_research_private.request_reserve_state()');
 const used=()=>v('select day_used from icash_dealmachine_request_budget where id=1');
 const resetMinute=()=>q("update icash_dealmachine_request_budget set minute_start=now()-interval '2 minutes',minute_used=60");
 const eligible=a=>v('select icash_new_user_request_reserve_eligible($1)',[a]);
 const seed=(n,age='1 hour')=>v('select fixture_reserve_seed($1,$2::interval)',[n,age]);
 try{
  await installReservePrerequisites(pg);
  await q("update icash_dealmachine_request_budget set day_start=now()-interval '10 hours',day_used=8820,minute_used=0");
  const before=await v('select to_jsonb(b) from icash_dealmachine_request_budget b');
  await pg.exec(read('config/new-user-request-reserve.sql'));
  assert.deepEqual(await v('select to_jsonb(b) from icash_dealmachine_request_budget b'),before,'installation preserves every counter/window');
  assert.equal((await state()).enabled,false);
  assert.equal((await state()).ordinaryRemaining,980);
  assert.equal(await v('select icash_take_dealmachine_request()'),true,'disabled policy preserves ordinary legacy admission');
  await q('update icash_research_private.request_reserve_policy set enabled=true');
  await q('update icash_dealmachine_request_budget set day_used=8819');
  const a=await seed(1),b=await seed(2),old=await seed(3,'25 hours');
  assert.equal(await eligible(a),true);assert.equal(await eligible(old),false);
  assert.equal(await cap(1),true);assert.equal(await cap(2),false);assert.equal(await cap(2,a),true);
  assert.equal(await v('select icash_take_dealmachine_request()'),true);
  assert.equal(await used(),8820);
  assert.equal(await cap(1),false);assert.equal(await cap(1,a),true);
  assert.equal(await v('select icash_take_dealmachine_request()'),false,'legacy requests cannot consume the reserve');
  for(const [account,kind,operation] of [[old,'owner_preview','starter'],[null,'owner_preview','starter'],[a,'photo','starter'],[a,'exclusion_sync','starter'],[a,'buyer_search','starter'],[a,'owner_preview',null]]){
   assert.equal(await claim(account,kind,uid(id++),operation),false);
  }
  assert.equal(await used(),8820,'refusals never spend a request');
  const request=uid(id++);
  assert.equal(await claim(a,'owner_preview',request),true);
  assert.equal(await claim(a,'owner_preview',request),false,'the original request ID is never readmitted');
  assert.equal(await used(),8821);
  assert.equal((await state()).reserveUsed,1);assert.equal((await state()).reserveRemaining,979);
  assert.equal((await state()).ordinaryRemaining,0,'spent reserve is not replenished from ordinary work');
  const original=await v('select to_jsonb(r) from icash_research_private.requests r where id=$1',[request]);
  assert.equal(await v('select icash_finish_dealmachine_request($1,$2)',[request,{outcome:'unknown'}]),true);
  assert.equal(await claim(a,'owner_preview',request),false,'unknown provider outcome remains one-use');
  assert.equal(await used(),8821);
  assert.equal(original.admitted,true);
  await assert.rejects(q('update icash_research_private.request_reserve_admissions set first_funded_at=now()'),/immutable/);
  await assert.rejects(q('delete from icash_research_private.request_reserve_admissions'),/immutable/);
  await q('delete from icash_research_private.requests where id=$1',[request]);
  assert.equal(await claim(a,'owner_preview',request),false,'pruning the larger request ledger does not erase compact one-use proof');

  for(let n=1;n<50;n++)assert.equal(await claim(a),true);
  assert.equal(await eligible(a),false);assert.equal(await claim(a),false,'one starter account cannot drain the pool');
  assert.equal((await state()).reserveUsed,50);
  assert.equal(await eligible(b),true);assert.equal(await cap(3,b),true);
  await resetMinute();
  assert.equal(await claim(b,'owner_lookup'),true,'another new account has independent protected capacity');
  assert.equal(await claim(b,'property_search'),true);
  assert.equal(await claim(b,'search_estimate'),true);
  assert.equal(await claim(b,'geography'),true);
  assert.equal(await claim(b,'property_lookup'),true);

  // Account eligibility is rechecked at request admission, without mutating
  // controls, membership, balances or historical funding evidence.
  for(const [change,undo] of [
   ["update icash_accounts set bot_paused=true where id=$1","update icash_accounts set bot_paused=false where id=$1"],
   ["update icash_accounts set membership_allowed=false where id=$1","update icash_accounts set membership_allowed=true where id=$1"],
   ["update icash_accounts set workspace_ack_version=null where id=$1","update icash_accounts set workspace_ack_version='fixture' where id=$1"],
   ["update icash_wallets set reserved_cents=balance_cents where account_id=$1","update icash_wallets set reserved_cents=0 where account_id=$1"],
   ["insert into icash_billing_reviews values($1,null)","delete from icash_billing_reviews where account_id=$1"],
   ["insert into icash_support_cancel_requests values($1,now())","delete from icash_support_cancel_requests where account_id=$1"]
  ]){
   await q(change,[b]);const count=await used();assert.equal(await eligible(b),false);assert.equal(await claim(b),false);assert.equal(await used(),count);await q(undo,[b]);
  }
  await q("insert into icash_funding_orders(account_id,credited_at) values($1,now())",[old]);
  assert.equal(await eligible(old),false,'a top-up does not restart first-funding eligibility');
  const testOnly=await seed(4);await q("update icash_funding_orders set mode='test' where account_id=$1",[testOnly]);assert.equal(await eligible(testOnly),false);
  const uncredited=await seed(5);await q('update icash_funding_orders set credited_at=null where account_id=$1',[uncredited]);assert.equal(await eligible(uncredited),false);
  const future=await seed(6,'-1 hour');assert.equal(await eligible(future),false);
  const atBoundary=await seed(7,'24 hours');assert.equal(await eligible(atBoundary),false);

  await q("update icash_research_private.quota_feedback set blocked_until=now()+interval '1 minute'");
  let count=await used();assert.equal(await cap(1,b),false);assert.equal(await claim(b),false);assert.equal(await used(),count);
  await q('update icash_research_private.quota_feedback set blocked_until=null');
  await q('update icash_dealmachine_request_budget set minute_start=now(),minute_used=60');
  assert.equal(await cap(1,b),false);assert.equal(await claim(b),false);assert.equal(await used(),count);
  await resetMinute();
  await q('update icash_dealmachine_request_budget set day_used=9799');
  assert.equal((await state()).reserveRemaining,1,'the protected pool never exceeds real remaining quota');
  assert.equal(await cap(2,b),false);assert.equal(await claim(b),true);
  assert.equal(await used(),9800);assert.equal((await state()).reserveRemaining,0);
  assert.equal(await cap(1,b),false);assert.equal(await claim(b),false);
  await q('update icash_research_private.request_reserve_policy set enabled=false');
  await q('update icash_research_private.request_reserve_policy set enabled=true');
  assert.equal((await state()).reserveRemaining,0,'enabling after exhaustion never invents reserve or resets quota');

  // Expired-window reads calculate fresh capacity without writing. A normal
  // admitted request alone advances both windows; account allowance persists.
  await q("update icash_dealmachine_request_budget set day_start=now()-interval '25 hours',minute_start=now()-interval '2 minutes',minute_used=60");
  const expired=await v('select to_jsonb(b) from icash_dealmachine_request_budget b');
  assert.equal((await state()).ordinaryRemaining,8820);assert.equal((await state()).reserveRemaining,980);
  assert.equal(await cap(2),true);assert.equal(await eligible(a),false,'quota reset cannot reset a starter account cap');
  assert.deepEqual(await v('select to_jsonb(b) from icash_dealmachine_request_budget b'),expired);
  assert.equal(await v('select icash_take_dealmachine_request()'),true);
  assert.equal(await used(),1);assert.equal((await state()).reserveUsed,0);
  assert.equal(await claim(a),true,'exhausted starter allowance does not block ordinary capacity');

  // Explicitly reduce configuration in a transaction only to prove safe
  // arithmetic; rollback does not rewrite the production reserve policy.
  await pg.exec('begin;update icash_research_private.request_reserve_policy set reserve_requests=3;update icash_dealmachine_request_budget set day_used=9797;');
  assert.equal((await state()).reserveRemaining,3);assert.equal(await v('select icash_take_dealmachine_request()'),false);
  assert.equal(await claim(b),true);assert.equal(await claim(b),true);assert.equal(await claim(b),true);assert.equal(await claim(b),false);
  assert.equal((await state()).reserveUsed,3);assert.equal(await used(),9800);await pg.exec('rollback');

  for(const role of ['anon','authenticated'])for(const signature of ['public.icash_take_dealmachine_request()','public.icash_take_dealmachine_request(text,uuid,text,uuid)','public.icash_dealmachine_capacity_available(integer,uuid)','public.icash_new_user_request_reserve_eligible(uuid)']){
   assert.equal(await v('select has_function_privilege($1,$2,\'EXECUTE\')',[role,signature]),false);
  }
  for(const signature of ['icash_research_private.take_reserved_request(text,uuid,text,uuid)','icash_research_private.request_reserve_state(timestamptz)','icash_research_private.starter_request_allowance(uuid,timestamptz)'])assert.equal(await v('select has_function_privilege(\'service_role\',$1,\'EXECUTE\')',[signature]),false);
  await pg.exec('set role service_role');
  assert.equal(await v('select public.icash_take_dealmachine_request()'),true,'service can use legacy wrapper with private storage');
  await pg.exec('reset role');
  console.log('PASS request reserve: real limiter prerequisites, disabled install, 980 protected slots, earliest live funding, per-account 50 cap, one-use receipts, holds, private ACLs and normal reset.');
 }finally{await pg.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await testNewUserRequestReserve();
