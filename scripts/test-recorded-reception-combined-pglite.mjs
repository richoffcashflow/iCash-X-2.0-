// LOCAL COMBINED RELEASE SIMULATION. Derived from the released channel-choice fixture; rebased onto owner release111c7.
// Preserves that fixture; adds inactive incoming schema compatibility. Synthetic accounts only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOperationalContactFixture} from '../tests/helpers/operational-contact-fixture.mjs';
const f=await createOperationalContactFixture(process.argv[2]);
const {pg,q,rpc,one,isolated,account,user,otherUser,other,newOwner,phone,screening,source,prepare,project}=f;
const policy='outreach-channels-2026-10-03.1';
const save=(mode='outbound_voice_sms',who=user,a=account)=>rpc('icash_record_outreach_campaign',{p_account:a,p_user:who,p_mode:mode,p_version:policy,p_accepted:true});
const eligible=(channel='voice')=>rpc('icash_outreach_'+channel+'_current',{p_account:account});
const role=async(name,action)=>{await q('set role '+name);try{return await action();}finally{await q('reset role');}};
try{
 await pg.exec(readFileSync(new URL('../config/outbound-billing-queue.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync(new URL('../config/dealmachine-dnc-observations.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync(new URL('../config/required-call-recording.sql',import.meta.url),'utf8'));
 await q('alter default privileges in schema public grant all on tables to service_role'); // Synthetic permissive hosted defaults.
 await pg.exec(readFileSync(new URL('../config/self-service-outreach-campaigns.sql',import.meta.url),'utf8'));
 // Combined release compatibility: channel choice + inactive owner111c7 plus this additive
 // incoming recording schema. No configs, policies or rates are created here.
 await pg.exec(readFileSync(new URL('../config/owner-recording-test.sql',import.meta.url),'utf8'));
 for(const table of ['icash_owner_recording_test_config','icash_owner_recording_test_runs'])assert.equal((await one('select count(*)::int n from public.'+table)).n,0);
 await pg.exec(readFileSync(new URL('../config/general-reception.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync(new URL('../config/recorded-reception.sql',import.meta.url),'utf8'));
 for(const table of ['configs','cost_policies','sessions','automatic_settlements'])assert.equal((await one('select count(*)::int n from icash_recorded_reception_private.'+table)).n,0);
 for(const table of ['configs','cost_policies','sessions','automatic_settlements'])assert.equal((await one("select has_table_privilege('service_role',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed",['icash_recorded_reception_private.'+table])).allowed,false);
 console.log('Combined incoming schema installs capture-OFF alongside released core+DNC+outbound recording+channel choices+inactive owner acceptance, with zero new policies/configs/sessions and restricted ACLs.');

 for(const privilege of ['UPDATE','DELETE','TRUNCATE'])assert.equal((await one("select has_table_privilege('service_role','icash_campaign_channel_selections',$1) allowed",[privilege])).allowed,false);
 await assert.rejects(q('truncate icash_campaign_channel_selections cascade'),/append-only/i);
 const oldAcknowledgment=await one('select * from icash_campaign_acknowledgments where account_id=$1',[account]);
 await q('update icash_outreach_campaigns set enabled=false,reviewed_principal=null where account_id=$1',[account]);
 await q('update icash_accounts set bot_paused=true where id=$1',[account]);
 const before=await one('select to_jsonb(a) account,to_jsonb(w) wallet from icash_accounts a join icash_wallets w on w.account_id=a.id where a.id=$1',[account]);
 assert.equal(await eligible(),false);assert.equal(await eligible('sms'),false);
 for(const deniedRole of ['anon','authenticated'])await assert.rejects(role(deniedRole,()=>save()),/permission denied/);
 for(const bad of [()=>save('outbound_voice_sms',otherUser),()=>save('outbound_voice_sms',user,other),()=>save('unknown'),()=>rpc('icash_record_outreach_campaign',{p_account:account,p_user:user,p_mode:'outbound_voice_sms',p_version:policy,p_accepted:false})])await assert.rejects(bad(),/ownership|Choose channels/);
 const status=await role('service_role',()=>save());
 assert.equal(status.mode,'outbound_voice_sms');assert.equal(status.released,true);assert.equal(status.principal,'SIMULATION business');
 assert.equal(await eligible(),true);assert.equal(await eligible('sms'),true);
 assert.equal(await rpc('icash_sms_inbound_campaign_current',{p_account:account}),false);
 assert.deepEqual(await one('select to_jsonb(a) account,to_jsonb(w) wallet from icash_accounts a join icash_wallets w on w.account_id=a.id where a.id=$1',[account]),before,'Selection preserves pause, limits and wallet');
 assert.deepEqual(await one('select * from icash_campaign_acknowledgments where id=$1',[oldAcknowledgment.id]),oldAcknowledgment,'Historical SMS-only receipt retained exactly');
 assert.equal((await one('select reviewed_principal from icash_outreach_campaigns where account_id=$1',[account])).reviewed_principal,null);
 assert.equal((await one('select count(*)::int n from icash_contact_permissions')).n,0);
 assert.equal((await one('select count(*)::int n from icash_voice_jobs')).n,0);
 assert.equal((await one('select count(*)::int n from icash_campaign_channel_selections')).n,1);
 await save();assert.equal((await one('select count(*)::int n from icash_campaign_channel_selections')).n,1,'Same selection is idempotent');
 for(const table of ['icash_campaign_acknowledgments','icash_campaign_channel_selections'])await assert.rejects(q('update '+table+' set user_id=$1 where account_id=$2',[otherUser,account]),/immutable|append-only/i);
 await isolated(async()=>{await q("update icash_customer_identities set company_name='Other business' where account_id=$1",[account]);assert.equal(await eligible(),false);assert.equal(await eligible('sms'),false);await save();assert.equal(await eligible(),true);});
 await isolated(async()=>{await q('update icash_accounts set owner_user_id=$1 where id=$2',[newOwner,account]);assert.equal(await eligible(),false);assert.equal(await eligible('sms'),false);});
 await save('sms_inbound');assert.equal(await eligible(),false);assert.equal(await eligible('sms'),true);assert.equal(await rpc('icash_sms_inbound_campaign_current',{p_account:account}),true);
 const costs={dealmachine:0,elevenlabs:1000,twilio:0,messaging:0,email:0,llm:0,vercel:0,railway:0,supabase:0,github:0,payments:0,title_and_signing:0,support_and_overhead:0,acquisition:0,refund_and_dispute_reserve:0,other:0};
 const rate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values('seller_call','SIMULATION channel choice',100,$1,'SIMULATION all components',now()-interval '1 minute',now()+interval '1 day',true,600) returning id",[costs])).id;
 await q("insert into icash_voice_configs(account_id,enabled,agent_id,phone_number_id,agent_config_hash,reviewed_until,seller_rate_id,max_duration_seconds,required_tool_ids) values($1,true,'agent_simulation','simulation-number',repeat('b',64),now()+interval '1 day',$2,600,array['callback','handoff'])",[account,rate]);
 await q('update icash_accounts set bot_paused=false where id=$1',[account]); // Synthetic fixture only.
 await prepare();await rpc('icash_queue_voice_jobs');assert.equal((await one('select count(*)::int n from icash_voice_jobs')).n,0,'SMS-only cannot queue outbound');
 await save();await rpc('icash_queue_voice_jobs');const job=await one('select * from icash_voice_jobs where account_id=$1',[account]);assert.equal(job.permission_id,null);assert(job.operational_contact_id);
 await q("update icash_voice_jobs set state='issued' where id=$1",[job.id]);
 const op=await one('select * from icash_operational_contacts where id=$1',[job.operational_contact_id]);
 const now=(await one('select now() stamp')).stamp;
 assert.equal(await rpc('icash_reserve_paced_voice',{p_account:account,p_job:job.id,p_rate:rate,p_permission_until:op.eligibility_until,p_financial_checked_at:now,p_financial_eligible:true}),true);
 const claim=()=>rpc('icash_claim_reviewed_voice_job',{p_job:job.id,p_offer_snapshot:null,p_buyer_snapshot:null});
 await isolated(async()=>{await save('sms_inbound');assert.equal(await claim(),false);assert.equal((await one('select state from icash_voice_jobs where id=$1',[job.id])).state,'issued');});
 for(const [sql,args] of [['update icash_accounts set bot_paused=true where id=$1',[account]],['update icash_dnc_verification_sources set enabled=false where id=$1',[source]],["insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[phone]],["update icash_customer_identities set company_name='Changed' where account_id=$1",[account]]])await isolated(async()=>{await q(sql,args);assert.equal(await claim(),false,sql);});
 if(process.env.OPERATIONAL_NATIVE_TEST==='1'){
  const {Client,connection}=await import('../tests/helpers/operational-native-db.mjs');const second=new Client(connection);await second.connect();
  try{
   await second.query('begin');await second.query('select public.icash_record_outreach_campaign($1,$2,$3,$4,true)',[account,user,'sms_inbound',policy]);
   const waiting=claim();let locked=false;
   for(let attempt=0;attempt<50;attempt++){await second.query('select pg_stat_clear_snapshot()');const rows=await second.query("select count(*)::int n from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%icash_claim_reviewed_voice_job%'");if(rows.rows[0].n>0){locked=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
   assert(locked,'Actual final voice claim waits on concurrent selection lock');
   await second.query('commit');assert.equal(await waiting,false,'Committed SMS choice wins race before dispatch');
   assert.equal((await one('select state from icash_voice_jobs where id=$1',[job.id])).state,'issued');await save();
  }finally{await second.query('rollback');await second.end();}
 }
 assert.equal(await claim(),true);assert.equal(await claim(),false,'Final voice claim remains one-use');
 assert.equal((await one('select count(*)::int n from icash_contact_permissions')).n,0);
 // SMS uses the same explicit choice, while inbound invitations remain SMS-only.
 await project();const thread=await one('select * from icash_text_threads where account_id=$1',[account]);
 assert.equal(await rpc('icash_sms_thread_review_current',{p_account:account,p_thread:thread.id,p_check_hour:true}),true);
 const opener=await rpc('icash_queue_seller_opener',{p_account:account,p_thread:thread.id});assert(opener);
 assert(await rpc('icash_claim_text',{p_account:account,p_message:opener,p_sender:thread.sender}));
 console.log('Self-service channel choices passed: actual owner/principal/version binding, historical SMS receipts, no operator review or synthetic contact consent, unchanged pause/wallet, SMS-only exclusion, real voice reserve/final claim, SMS final claim, DNC/STOP/identity holds'+(process.env.OPERATIONAL_NATIVE_TEST==='1'?' and native concurrent mode-change race.':'.'));
}finally{await pg.close();}
