import assert from 'node:assert/strict';

// Real SQL admission and immutable configuration renewal, synthetic callers only.
export async function testReceptionReturnCallLimit(f){
 const {db,q,val,rpc,read,scenario,config,account,trans,boundPayload}=f;
 const migration=read('config/reception-return-call-limit.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 async function setup(){
  await q('update icash_recorded_reception_private.configs set enabled=false where id=$1',[config]);
  await q(`insert into icash_recorded_reception_private.configs select (jsonb_populate_record(null::icash_recorded_reception_private.configs,to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),'version',2,'enabled',true,'entry_policy','direct_recorded_v1'))).* from icash_recorded_reception_private.configs c where id=$1`,[config]);
  await q('update public.icash_wallets set balance_cents=100000');
  await q('update public.icash_daily_allowances set base_cents=100000');
 }
 const active=()=>val('select to_jsonb(c) from icash_recorded_reception_private.configs c where enabled');
 const at=ms=>db.exec(`create or replace function icash_recorded_reception_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$select '${new Date(ms).toISOString()}'::timestamptz$$;`);
 async function admit(i,extra={}){
  const c=await active(),hex=i.toString(16);
  return f.reserve({p_config_id:c.id,p_call_sid:'CA'+hex.padStart(32,'0'),p_nonce_hash:hex.padStart(64,'0'),p_stop_token_hash:(i+100).toString(16).padStart(64,'0'),...extra},'icash_reserve_direct_reception');
 }
 async function end(r){
  const {timeLimitSeconds,...identity}=boundPayload(r);
  assert(await trans('call_ended',{...identity,status:'canceled'},r));
 }
 const rows=()=>val('select coalesce(jsonb_agg(to_jsonb(s) order by created_at),\'[]\'::jsonb) from icash_recorded_reception_private.sessions s');
 const finances=()=>val(`select jsonb_build_object('wallet',(select to_jsonb(w) from public.icash_wallets w),'daily',(select to_jsonb(d) from public.icash_daily_allowances d),'activation',(select to_jsonb(a) from public.icash_spend_activations a),'budget',(select to_jsonb(b) from public.icash_operating_budget b))`);
 await scenario('third callback after two completed calls is admitted without rewriting history or increasing funds',async()=>{
  await setup();const before=await active(),now=Date.now();
  await at(now-40*60000);let a=await admit(1);assert(a.allowed,JSON.stringify(a));await end(a.session);
  await at(now-15*60000);a=await admit(2);assert(a.allowed,JSON.stringify(a));await end(a.session);
  await at(now);assert.equal((await admit(3)).reason,'caller_throttled');
  const history=await rows(),funds=await finances();
  await db.exec(migration);const after=await active();
  assert.equal(after.caller_max_calls,5);assert.equal(after.caller_window_seconds,60);
  for(const key of Object.keys(before))if(!['id','version','caller_max_calls','caller_window_seconds','created_at','approved_at','approval_reference'].includes(key))assert.deepEqual(after[key],before[key],key);
  assert.deepEqual(await val('select to_jsonb(c) from icash_recorded_reception_private.configs c where id=$1',[before.id]),{...before,enabled:false});
  assert.deepEqual(await rows(),history);assert.deepEqual(await finances(),funds);
  await db.exec(migration);assert.deepEqual(await active(),after);
  a=await admit(3);assert(a.allowed,JSON.stringify(a));assert.equal(a.session.config_id,after.id);
  assert.equal((await admit(3)).reason,'duplicate_call');
  assert.equal((await admit(4)).reason,'concurrency_limit');
 });
 await scenario('five short admissions are allowed, sixth is throttled, and a callback works after the minute',async()=>{
  await setup();await db.exec(migration);const now=Date.now();await at(now);
  for(let i=1;i<=5;i++){const a=await admit(i);assert(a.allowed,JSON.stringify(a));await end(a.session);}
  assert.equal((await admit(6)).reason,'caller_throttled');
  assert.equal((await rows()).length,5);
  await at(now+61000);assert.equal((await admit(6)).allowed,true);
 });
 for(const [label,sql,reason] of [
  ['empty wallet','update public.icash_wallets set balance_cents=0','insufficient_call_allowance'],
  ['daily allowance exhausted','update public.icash_daily_allowances set base_cents=0','insufficient_call_allowance'],
  ['paused account','update public.icash_accounts set bot_paused=true','account_paused_or_changed'],
  ['spending disabled','update public.icash_spend_activations set enabled=false','customer_funding_denied']
 ])await scenario('return-call renewal still respects '+label,async()=>{
  await setup();await db.exec(migration);await q(sql);const a=await admit(1);
  assert.equal(a.allowed,false);assert.equal(a.reason,reason);
  assert.equal((await rows()).length,0);assert.equal(await val('select reserved_cents from public.icash_wallets'),0);
 });
 await scenario('return-call renewal cannot interrupt a call or be changed by browser roles',async()=>{
  await setup();const a=await admit(1);assert(a.allowed);const before=await active();
  await q('savepoint active_call');await assert.rejects(db.exec(migration),/Finish the active call/);await q('rollback to savepoint active_call');
  assert.deepEqual(await active(),before);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await val("select has_table_privilege($1,'icash_recorded_reception_private.configs','UPDATE')",[role]),false);
 });
}
