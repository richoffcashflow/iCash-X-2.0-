// SIMULATION ONLY. Real operational eligibility, inventory exclusion and reserve
// chain in isolated PostgreSQL. No providers, customer rows or live RPC calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const require=createRequire(import.meta.url),f=await createOperationalContactFixture(require.resolve('@electric-sql/pglite'),{automaticChannels:true});
const {pg,q,rpc,one,isolated,account,other,screening,phone,owners,dnc,prepare}=f;
try{
 await pg.exec(`create table if not exists public.icash_outbound_property_owners(property_id text primary key,account_id uuid);
 create function public.icash_meta_contact_only(uuid,uuid,text) returns boolean language sql stable as $$select false$$;
 create function public.icash_voice_outreach_hours_current(uuid,uuid) returns boolean language sql stable as $$select true$$;
 create function public.icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql stable as $$select null::jsonb$$;`);
 const fixture=read('tests/fixtures/matched-seller-inventory-upstream.sql');
 // Preserve the current cold-inventory branch including its assignment check
 // and the production E.164 normalization. Shared sellers have their own suite.
 await pg.exec(fixture.replace("'^\\+[1-9][0-9]{7,14}$'",()=>"'^[+][1-9][0-9]{7,14}$'"));
 await prepare();
 const contact=await one("select * from icash_operational_contacts where account_id=$1 and channel='voice'",[account]);
 const job=(await one("insert into icash_voice_jobs(account_id,operational_contact_id,state) values($1,$2,'issued') returning id",[account,contact.id])).id;
 const rate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) select 'seller_call','SIMULATION operational reservation',charge_cents,costs_micros,evidence_ref,verified_at,expires_at,true,600 from icash_operation_rates where id=$1 returning id",[owners])).id;
 const key='voice:'+job;
 const reserve=(owner=account,operation=key,financial=true)=>rpc('icash_reserve_before_activation',{p_account:owner,p_operation:operation,p_rate:rate,p_permission_until:new Date(Date.now()+3600000).toISOString(),p_financial_checked_at:financial?new Date(Date.now()-1000).toISOString():null,p_financial_eligible:financial});
 assert.equal(await rpc('icash_operational_contact_current',{p_account:account,p_contact:contact.id,p_channel:'voice',p_check_hour:false}),true);
 await assert.rejects(()=>reserve(),/Seller inventory assigned or suppressed/,'reproduce exact operational-pointer failure');
 assert.equal((await one('select count(*)::int n from icash_operation_spend where operation_key=$1',[key])).n,0);
 const sql=read('config/operational-seller-reservation.sql');assert.equal(sql,read('supabase/migrations/20261019174555_operational_seller_reservation.sql'));
 const before=(await one("select pg_get_functiondef('icash_reserve_before_activation(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure) d")).d;
 const permissions=()=>one("select has_function_privilege('anon','icash_reserve_before_activation(uuid,text,uuid,timestamptz,timestamptz,boolean)','execute') anon,has_function_privilege('authenticated','icash_reserve_before_activation(uuid,text,uuid,timestamptz,timestamptz,boolean)','execute') customer,has_function_privilege('service_role','icash_reserve_before_activation(uuid,text,uuid,timestamptz,timestamptz,boolean)','execute') service");
 const aclBefore=await permissions();
 await pg.exec(sql);
 assert.deepEqual(await permissions(),aclBefore,'existing private reservation ACLs unchanged');
 const after=(await one("select pg_get_functiondef('icash_reserve_before_activation(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure) d")).d;
 const tail='elsif op in (\'sms_send\',\'mms_send\') then';
 assert.equal(after.slice(after.indexOf(tail)),before.slice(before.indexOf(tail)),'all downstream inventory/Meta/financial delegates and other operation branches remain exact');
 await isolated(async()=>{
  assert.equal((await reserve()).state,'reserved');
  assert.equal((await one('select count(*)::int n from icash_operation_spend where operation_key=$1',[key])).n,1);
  assert.equal((await one('select account_id from icash_inventory_claims where resource_key=$1',['property:prop_1001'])).account_id,account);
 });
 await isolated(async()=>{
  // Exercise the actual current post-hours paced adapter, whose preliminary
  // inventory claim used to be followed by the broken activation lookup.
  const baseline=JSON.parse(read('tests/fixtures/meta-contention-baseline.json'));
  await pg.exec(baseline.icash_reserve_paced_voice);
  assert.equal(await rpc('icash_reserve_paced_voice',{p_account:account,p_job:job,p_rate:rate,p_permission_until:new Date(Date.now()+3600000).toISOString(),p_financial_checked_at:new Date(Date.now()-1000).toISOString(),p_financial_eligible:true}),true);
  const saved=await one('select * from icash_operation_spend where operation_key=$1',[key]);
  assert.equal(await rpc('icash_reserve_paced_voice',{p_account:account,p_job:job,p_rate:rate,p_permission_until:new Date(Date.now()+3600000).toISOString(),p_financial_checked_at:new Date(Date.now()-1000).toISOString(),p_financial_eligible:true}),true);
  assert.deepEqual(await one('select * from icash_operation_spend where operation_key=$1',[key]),saved,'deterministic reservation reused, no new charge or quote');
 });
 await isolated(async()=>{await assert.rejects(()=>reserve(other),/Seller inventory assigned or suppressed/);});
 for(const [name,query,args=[]] of [
  ['other account target','update icash_voice_jobs set account_id=$2 where id=$1',[job,other]],
  ['expired operational source',"update icash_operational_contacts set eligibility_until=now()-interval '1 second' where id=$1",[contact.id]],
  ['revoked operational source',"update icash_operational_contacts set revoked_at=now() where id=$1",[contact.id]],
  ['DNC denial','update icash_dnc_verification_receipts set clear=false where id=$1',[dnc]],
  ['expired DNC',"update icash_dnc_verification_receipts set expires_at=now()-interval '1 second' where id=$1",[dnc]],
  ['changed owner source',"update icash_owner_contacts set result=jsonb_set(result,'{contacts}','[]') where screening_id=$1",[screening]],
  ['STOP',"insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION stop')",[phone]],
  ['another inventory owner',"insert into icash_inventory_claims(resource_key,account_id,screening_id,cooldown_until) values('property:prop_1001',$1,$2,now()+interval '1 day')",[other,screening]],
  ['outbound ownership',"insert into icash_outbound_property_owners values('prop_1001',$1)",[other]],
 
 ])await isolated(async()=>{
  // Fixture-only corrupt/historical rows exercise defence in depth after the
  // real immutable binding triggers have already been covered separately.
  if(name==='other account target')await pg.exec('alter table icash_voice_jobs disable trigger icash_voice_operational_binding');
  if(name==='expired operational source')await pg.exec('alter table icash_operational_contacts disable trigger icash_operational_contact_immutable');
  await q(query,args);
  if(name==='other account target')await pg.exec('alter table icash_voice_jobs enable trigger icash_voice_operational_binding');
  if(name==='expired operational source')await pg.exec('alter table icash_operational_contacts enable trigger icash_operational_contact_immutable');
  await assert.rejects(()=>reserve(),/Seller inventory assigned or suppressed/,name);
 });
 await isolated(async()=>{await assert.rejects(()=>reserve(account,key,false),/financial|Financial/,'screening eligibility still required');});
 await isolated(async()=>{await q('update icash_accounts set bot_paused=true where id=$1',[account]);await assert.rejects(()=>reserve(),/paused|Paused|stopped|Stopped/,'Pause remains in the original reserve chain');});
 await isolated(async()=>{
  // Deliberately share a UUID across the two source tables. Resolve the job's
  // actual source discriminator, never an arbitrary row from the UNION view.
  await q("insert into icash_contact_permissions(id,account_id,screening_id,party,phone,contact_key,timezone,permission_evidence,permission_until,dnc_checked_at,dnc_clear) values($1,$2,$3,'seller','+12145550999',encode(sha256(convert_to('+12145550999','UTF8')),'hex'),'America/Chicago','SIMULATION distinct explicit permission',now()+interval '1 day',now(),true)",[contact.id,account,screening]);
  assert.equal((await reserve()).state,'reserved');
  assert.equal((await one("select count(*)::int n from icash_inventory_claims where resource_key='phone:'||encode(sha256(convert_to($1,'UTF8')),'hex')",[phone])).n,1,'operational phone selected despite UUID collision');
  assert.equal((await one("select count(*)::int n from icash_inventory_claims where resource_key='phone:'||encode(sha256(convert_to('+12145550999','UTF8')),'hex')")).n,0);
 });
 await isolated(async()=>{
  await q("insert into icash_contact_permissions(id,account_id,screening_id,party,phone,contact_key,timezone,permission_evidence,permission_until,dnc_checked_at,dnc_clear) values($1,$2,$3,'seller','+12145550999',encode(sha256(convert_to('+12145550999','UTF8')),'hex'),'America/Chicago','SIMULATION explicit target',now()+interval '1 day',now(),true)",[contact.id,account,screening]);
  await pg.exec('alter table icash_voice_jobs drop constraint icash_voice_job_contact_source;alter table icash_voice_jobs disable trigger icash_voice_operational_binding');
  await q('update icash_voice_jobs set permission_id=operational_contact_id where id=$1',[job]);
  await pg.exec('alter table icash_voice_jobs enable trigger icash_voice_operational_binding');
  await assert.rejects(()=>reserve(),/Seller inventory assigned or suppressed/,'ambiguous two-pointer job fails closed even without table constraint');
 });
 console.log('PASS operational seller reservation: real failure reproduced; bound target/source, DNC/expiry/STOP/inventory/Pause/financial gates, pointer ambiguity and idempotent reservation retained. No provider traffic.');
}finally{await pg.close();}
