// Actual deployed admission functions in local PostgreSQL, no provider work.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const baseline=JSON.parse(read('tests/fixtures/pro-voice-capacity-baseline.json'));
const migration=read('config/pro-voice-capacity.sql');
const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(p=>p.endsWith('_pro_voice_capacity.sql'));
assert.equal(files.length,1);assert.equal(read('supabase/migrations/'+files[0]),migration);
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create schema icash_recording_private;
 create table icash_operating_budget(id integer primary key,enabled boolean);insert into icash_operating_budget values(1,true);
 create table icash_voice_capacity_policy(id integer primary key,workspace_limit integer,verified_at timestamptz,source text,credit_state text,credit_verified_at timestamptz);
 alter table icash_voice_capacity_policy enable row level security;
 create table icash_voice_agent_capacity(agent_id text primary key,concurrent_limit integer,verified_at timestamptz);
 create table icash_voice_configs(account_id uuid,agent_id text,enabled boolean);
 create table icash_voice_jobs(id uuid,state text);
 create table icash_wallets(account_id uuid primary key,balance_cents bigint);
 create table icash_recording_private.capacity_quarantines(account_id uuid,operation_key text,contact_key text);
 create table fixture_slots(account_id uuid,operation_key text,agent_id text,contact_key text);
 create table fixture_holds(account_id uuid,operation_key text,contact_key text);
 create function icash_active_voice_slots() returns setof fixture_slots language sql stable as $$select * from public.fixture_slots$$;
 create function icash_voice_contact_holds() returns setof fixture_holds language sql stable as $$select * from public.fixture_holds$$;
 create function icash_voice_capacity_targets() returns jsonb language sql stable as $$select '[{"agentId":"agent_outgoing","branchId":null},{"agentId":"agent_incoming","branchId":"agtbrch_incoming"}]'::jsonb$$;
 create function icash_daily_allowance(uuid) returns jsonb language sql stable as $$select jsonb_build_object('remainingCents',balance_cents) from public.icash_wallets where account_id=$1$$;
 `);
 for(const f of baseline.functions)await pg.exec(f.definition);
 for(const f of baseline.functions)assert.equal(await val('select md5(pg_get_functiondef(oid)) from pg_proc where proname=$1',[f.name]),f.hash);
 const save=(total=20,outgoing=18,creditState='available')=>val('select icash_save_voice_capacity($1,$2::jsonb,$3)',[total,JSON.stringify([{agentId:'agent_outgoing',limit:outgoing,creditState},{agentId:'agent_incoming',limit:2,creditState}]),'Offline provider observation']);
 await save(10,8);await assert.rejects(()=>save(),/Verified capacity required/);
 const beforePolicy=await val('select to_jsonb(p) from icash_voice_capacity_policy p');
 await pg.exec(migration);
 const afterPolicy=await val('select to_jsonb(p) from icash_voice_capacity_policy p');
 assert.deepEqual(afterPolicy,{...beforePolicy,pro_change_claimed_at:null,pro_change_applied_at:null},'migration changes no observed capacity or credit evidence');
 for(const f of baseline.functions){
  const expected=f.definition.replace(f.name==='icash_save_voice_capacity'?'p_limit not between 1 and 10':'least(10,workspace_limit)',f.name==='icash_save_voice_capacity'?'p_limit not between 1 and 20':'least(20,workspace_limit)');
  assert.equal(await val('select pg_get_functiondef(oid) from pg_proc where proname=$1',[f.name]),expected,'all existing admission and hold logic is preserved');
 }
 await save();await assert.rejects(()=>save(21,19),/Verified capacity required/);
 for(let n=1;n<=10;n++){await q('insert into icash_wallets values($1,3000)',[id(n)]);await q("insert into icash_voice_configs values($1,'agent_outgoing',true)",[id(n)]);}
 const allowed=(incoming=false,account=id(9),contact='new-contact',operation='new-operation',agent=incoming?'agent_incoming':'agent_outgoing')=>val('select icash_voice_capacity_available($1,$2,$3,$4,$5)',[account,agent,operation,contact,incoming]);
 const open=()=>val('select icash_outgoing_voice_capacity_open()');
 const outgoing=n=>q("insert into fixture_slots values($1,$2,'agent_outgoing',$3)",[id(Math.floor((n-1)/3)+1),'outgoing-'+n,'contact-'+n]);
 const incoming=n=>q("insert into fixture_slots values($1,$2,'agent_incoming',$3)",[id(10),'recorded-reception:'+n,'incoming-'+n]);
 for(const incomingFirst of [true,false]){
  await pg.exec('truncate fixture_slots');
  if(incomingFirst){await incoming(1);await incoming(2);}
  for(let n=1;n<=18;n++){assert.equal(await allowed(),true,`slot ${n} available with incomingFirst=${incomingFirst}`);assert.equal(await open(),true);await outgoing(n);}
  assert.equal(await allowed(),false,'nineteenth outgoing cannot consume the incoming reserve');assert.equal(await open(),false);
  if(!incomingFirst){assert.equal(await allowed(true),true);await incoming(1);assert.equal(await allowed(true),true);await incoming(2);}
  assert.equal(await allowed(true),false,'total and incoming agent limits stop the twenty-first call');
 }
 await pg.exec('truncate fixture_slots');await outgoing(1);await outgoing(2);await outgoing(3);
 assert.equal(await allowed(false,id(1)),false,'original per-account fairness is preserved');assert.equal(await allowed(),true);
 assert.equal(await allowed(false,id(9),'contact-1'),false,'same recipient never overlaps');
 await q('insert into fixture_holds values($1,$2,$3)',[id(4),'uncertain','held-contact']);
 assert.equal(await allowed(false,id(9),'held-contact'),false,'uncertain recipient hold is unchanged');
 await q('update icash_wallets set balance_cents=0 where account_id=$1',[id(9)]);assert.equal(await allowed(),false);
 await q('update icash_wallets set balance_cents=3000 where account_id=$1',[id(9)]);
 await save(20,18,'exhausted');assert.equal(await allowed(),false);assert.equal(await open(),false);assert.equal(await allowed(true),true,'exhaustion preserves incoming reception');
 await save(20,18,'unknown');assert.equal(await allowed(),false,'unknown evidence cannot clear exhaustion');
 await save();assert.equal(await allowed(),true);
 const change=action=>val('select icash_pro_voice_capacity_change($1)',[action]);
 assert.deepEqual(await change('status'),{claimed:false,status:'ready'});
 assert.deepEqual(await change('complete'),{claimed:false,status:'ready'},'no completion without a durable claim');
 const claims=await Promise.all([change('claim'),change('claim')]);assert.equal(claims.filter(x=>x.claimed).length,1);
 await save();assert.deepEqual(await change('status'),{claimed:false,status:'claimed'},'ordinary observations cannot reset the claim');
 assert.deepEqual(await change('complete'),{claimed:false,status:'applied'});
 const receipt=await val('select pro_change_applied_at from icash_voice_capacity_policy');
 await save(10,8);assert.deepEqual(await change('claim'),{claimed:false,status:'applied'},'later manual reductions do not replay configuration');
 await change('complete');assert.deepEqual(await val('select pro_change_applied_at from icash_voice_capacity_policy'),receipt);
 await assert.rejects(()=>change('reset'),/Invalid capacity change action/);
 for(const role of ['anon','authenticated'])assert.equal(await val("select has_function_privilege($1,'icash_pro_voice_capacity_change(text)','execute')",[role]),false);
 assert.equal(await val("select has_function_privilege('service_role','icash_pro_voice_capacity_change(text)','execute')"),true);
 console.log('PASS Pro capacity: eighteen outgoing plus two incoming in either arrival order, exact existing admission/hold preservation, unchanged observations, exhausted-credit handling and one durable provider-write claim.');
}finally{await pg.close();}
