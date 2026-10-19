// Local PostgreSQL only: exact current validator and real source/DNC/contact gates.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const f=await createOperationalContactFixture(fileURLToPath(import.meta.resolve('@electric-sql/pglite')),{automaticChannels:true});
const {pg,q,rpc,one,isolated,account,user,other,newOwner,phone,source,dnc,screening,owners,prepare}=f;
try{
 await q("insert into icash_voice_configs(account_id,enabled,agent_id,phone_number_id,agent_config_hash,reviewed_until,seller_rate_id,max_duration_seconds,required_tool_ids) values($1,true,'agent_localfixture','fixture-number',$2,now()+interval '1 day',$3,600,array['callback','handoff'])",[account,'b'.repeat(64),owners]);
 assert.equal(await prepare(),2);
 await pg.exec("alter table icash_dnc_verification_receipts add column evidence_kind text default 'national_provider_observation'");
 await pg.exec('create table public.icash_timezone_names as select name from pg_timezone_names');
 await pg.exec(read('tests/fixtures/voice-queue-before-candidate-fence.sql'));
 await pg.exec(read('tests/fixtures/voice-queue-current-validator.sql'));
 const validator=(await one("select pg_get_functiondef('icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure) definition")).definition;
 await pg.exec(read('config/voice-queue-candidate-fence.sql'));
 await pg.exec(read('config/voice-queue-prior-route-scan.sql'));
 await pg.exec(read('config/voice-channel-candidate-fence.sql'));
 assert.equal((await one("select pg_get_functiondef('icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure) definition")).definition,validator);
 const op=(await one("select id from icash_operational_contacts where account_id=$1 and channel='voice'",[account])).id;
 assert.equal(await rpc('icash_operational_contact_current',{p_account:account,p_contact:op,p_channel:'voice',p_check_hour:false}),true);
 assert.equal(await rpc('icash_operational_contact_current',{p_account:other,p_contact:op,p_channel:'voice',p_check_hour:false}),false,'other account cannot validate this contact');
 const count=async()=>Number((await one('select count(*) n from icash_voice_jobs where operational_contact_id=$1',[op])).n);
 const queue=()=>rpc('icash_queue_voice_jobs',{});
 for(const [sql,args] of [
  ['update icash_dnc_verification_sources set enabled=false where id=$1',[source]],
  ["update icash_dnc_verification_sources set expires_at=now()-interval '1 second' where id=$1",[source]],
  ['update icash_dnc_verification_receipts set clear=false where id=$1',[dnc]],
  ["update icash_dnc_verification_receipts set checked_at=now()+interval '1 minute' where id=$1",[dnc]],
  ["update icash_dnc_verification_receipts set checked_at=now()-interval '31 days' where id=$1",[dnc]],
  ["update icash_dnc_verification_receipts set revoked_at=now() where id=$1",[dnc]],
  ['update icash_accounts set owner_user_id=$1 where id=$2',[newOwner,account]],
  ["update icash_customer_identities set company_name='Changed fixture business' where account_id=$1",[account]],
  ["update icash_owner_contacts set result=jsonb_set(result,'{contacts,0,phones,0,doNotCall}','true') where screening_id=$1",[screening]],
  ["insert into icash_text_suppressions(phone,reason) values($1,'LOCAL STOP')",[phone]],
  ['update icash_accounts set bot_paused=true where id=$1',[account]],
  ['update icash_outreach_campaigns set enabled=false where account_id=$1',[account]],
  ["update icash_outreach_campaigns set mode='sms_inbound' where account_id=$1",[account]],
  ['update icash_voice_configs set enabled=false where account_id=$1',[account]],
  ["update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"held\"}}' where id=$1",[screening]]
 ])await isolated(async()=>{
  if(sql.includes('icash_outreach_campaigns'))await rpc('icash_record_outreach_campaign',{p_account:account,p_user:user,p_mode:'outbound_voice_sms',p_version:'outreach-channels-2026-10-03.1',p_accepted:true});
  await q(sql,args);await queue();assert.equal(await count(),0,sql);
 });
 const moneyBefore=(await one('select to_jsonb(w) wallet from icash_wallets w where account_id=$1',[account])).wallet;
 const spendBefore=(await one('select count(*) n from icash_operation_spend')).n;
 await queue();await queue();assert.equal(await count(),1,'real eligible contact queues exactly once');
 await q("update icash_voice_jobs set state='held',outcome='provider_outcome_unknown_no_retry' where operational_contact_id=$1",[op]);
 await queue();
 assert.equal((await one('select outcome from icash_voice_jobs where operational_contact_id=$1',[op])).outcome,'provider_outcome_unknown_no_retry');
 assert.deepEqual((await one('select to_jsonb(w) wallet from icash_wallets w where account_id=$1',[account])).wallet,moneyBefore);
 assert.equal((await one('select count(*) n from icash_operation_spend')).n,spendBefore,'queue performance patch never authorizes spend');
 console.log('Voice candidate, prior-route and channel fences with exact live validator: real source/hash/owner/DNC/STOP/Pause/config/financial gates, account scope, unknown holds, idempotency and unchanged wallet/spend all pass. No provider calls.');
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await pg.close();}
