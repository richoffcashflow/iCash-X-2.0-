import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create(),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/operational-sms-candidate-fence.sql');
const query=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await query(s,a)).rows[0])[0];
const uid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0'),account=uid(1),other=uid(2);
const original="select oc.* from public.icash_operational_contacts oc\n  join public.icash_accounts a on a.id=oc.account_id and not a.bot_paused\n  where oc.channel='sms' and (p_account is null or oc.account_id=p_account) and oc.revoked_at is null and oc.eligibility_until>now()\n   and (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=oc.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')\n    or public.icash_operational_contact_current(oc.account_id,oc.id,'sms',false))\n   and not exists(select 1 from public.icash_text_threads th join public.icash_deal_files df on df.id=th.deal_id and df.account_id=th.account_id where th.retired_at is null and th.account_id=oc.account_id and df.screening_id=oc.screening_id and th.recipient=oc.phone)\n   and public.icash_prospect_sms_route_available(oc.account_id,oc.screening_id,oc.phone,public.icash_business_conversation_sender(oc.account_id,oc.screening_id,oc.phone))\n  order by oc.account_id,oc.phone,oc.id limit 100";
const part=label=>sql.split('text:=$'+label+'$')[1].split('$'+label+'$')[0];
const expected=original.replace(part('proof'),'\n').replace(part('route'),part('new_route'));
const improved='with candidates as materialized (\n '+expected;
const select=(s,a=null)=>query(s.replaceAll('p_account','$1::uuid'),[a]);
const calls=()=>one("select case when is_called then last_value else 0 end from proof_calls");
const resetCalls=()=>pg.exec("select setval('proof_calls',1,false)");
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,phone text,channel text default 'sms',revoked_at timestamptz,eligibility_until timestamptz default now()+interval '1 day',dnc_receipt_id uuid);
 create table icash_dnc_verification_receipts(id uuid primary key,evidence_kind text default 'national_provider_observation');
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid);
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,recipient text,retired_at timestamptz);
 create table fixture_policy(contact_id uuid primary key,account_id uuid,proof boolean default true,route boolean default true);
 create sequence proof_calls;
 create function icash_operational_contact_current(a uuid,c uuid,ch text,l boolean) returns boolean language plpgsql as $$begin
  perform nextval('proof_calls');return (select proof from fixture_policy where contact_id=c and account_id=a);
 end$$;
 create function icash_business_conversation_sender(a uuid,s uuid,p text) returns text language sql stable as $$select '+14243948384'::text$$;
 create function icash_prospect_sms_route_available(a uuid,s uuid,p text,sender text) returns boolean language sql stable as $$select route from fixture_policy where contact_id=s and account_id=a$$;`);
 for(const a of [account,other])await query('insert into icash_accounts values($1,false)',[a]);
 const add=async(n,{a=account,projected=false,proof=true,route=true}={})=>{
  const id=uid(n),phone='+1214'+String(n).padStart(7,'0');
  await query('insert into icash_dnc_verification_receipts(id) values($1)',[id]);
  await query('insert into icash_operational_contacts(id,account_id,screening_id,phone,dnc_receipt_id) values($1,$2,$1,$3,$1)',[id,a,phone]);
  await query('insert into fixture_policy values($1,$2,$3,$4)',[id,a,proof,route]);
  if(projected){
   await query('insert into icash_deal_files values($1,$2,$1)',[id,a]);
   await query('insert into icash_text_threads values($1,$2,$1,$3,null)',[id,a,phone]);
  }
  return id;
 };
 for(let n=100;n<300;n++)await add(n,{projected:true});
 await pg.exec('analyze');await resetCalls();
 assert.deepEqual((await select(original)).rows,[]);const oldCalls=Number(await calls());
 await resetCalls();assert.deepEqual((await select(improved)).rows,[]);assert.equal(Number(await calls()),0,'Existing conversations never re-run expensive proof');
 const valid=await add(1000),otherValid=await add(1001,{a:other}),invalid=await add(1002,{proof:false}),unknown=await add(1003,{proof:null});
 await add(1004,{route:false});await add(1005,{route:null});
 for(const [label,change,args] of [
  ['baseline',null,[]],['paused','update icash_accounts set bot_paused=true where id=$1',[other]],
  ['expired',"update icash_operational_contacts set eligibility_until=now()-interval '1 second' where id=$1",[otherValid]],
  ['revoked','update icash_operational_contacts set revoked_at=now() where id=$1',[otherValid]],
  ['voice channel',"update icash_operational_contacts set channel='voice' where id=$1",[otherValid]],
  ['retired thread','update icash_text_threads set retired_at=now() where id=$1',[uid(100)]],
  ['foreign thread','update icash_text_threads set account_id=$1 where id=$2',[other,uid(100)]],
  ['different recipient',"update icash_text_threads set recipient='+12145550000' where id=$1",[uid(100)]],
 ]){
  await pg.exec('begin');if(change)await query(change,args);
  assert.deepEqual((await select(improved)).rows,(await select(original)).rows,label);
  assert.deepEqual((await select(improved,account)).rows,(await select(original,account)).rows,label+' account scope');
  await pg.exec('rollback');
 }
 // Neither invalid proof nor blocked/NULL routes before the batch limit can
 // crowd out a valid later account, and valid ordering still caps at 100.
 for(let n=300;n<420;n++)await add(n,{proof:false});
 for(let n=420;n<540;n++)await add(n,{route:false});
 const rows=(await select(improved)).rows;assert.deepEqual(rows.map(x=>x.id),[valid,otherValid]);
 assert(!rows.some(x=>[invalid,unknown].includes(x.id)));
 for(let n=2000;n<2101;n++)await add(n);
 assert.deepEqual((await select(improved)).rows,(await select(original)).rows);
 assert.equal((await select(improved)).rows.length,100);
 await pg.exec('create function public.icash_project_operational_sms_contacts(p_account uuid default null) returns integer language plpgsql set search_path=public as $$declare c record;n integer:=0;begin for c in '+original+'\n loop n:=n+1;end loop;return n;end$$;');
 await pg.exec('revoke all on function icash_project_operational_sms_contacts(uuid) from public,anon,authenticated;grant execute on function icash_project_operational_sms_contacts(uuid) to service_role');
 const before=await one("select pg_get_functiondef('icash_project_operational_sms_contacts(uuid)'::regprocedure)");
 await pg.exec(sql);
 assert.equal(await one("select pg_get_functiondef('icash_project_operational_sms_contacts(uuid)'::regprocedure)"),before.replace(part('head'),part('new_head')).replace(part('proof'),'\n').replace(part('route'),part('new_route')),'Only selector fragments change');
 assert.equal(await one('select icash_project_operational_sms_contacts()'),100);
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_project_operational_sms_contacts(uuid)','execute')",[role]),false);
 assert.equal(await one("select has_function_privilege('service_role','icash_project_operational_sms_contacts(uuid)','execute')"),true);
 await assert.rejects(pg.exec(sql),/Operational SMS candidate prerequisite changed/);await pg.exec('rollback');
 assert.equal(sql,read('supabase/migrations/20261019195055_operational_sms_candidate_fence.sql'));
 console.log('PASS SMS candidate fence: '+oldCalls+' -> 0 proof calls for existing conversations, identical rows/order/account scope, false/NULL gates before batch limit and preserved private permissions.');
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await pg.close();}
