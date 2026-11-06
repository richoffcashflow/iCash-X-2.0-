import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadService} from './helpers/simulated-journey-services.mjs';

const read = path => readFileSync(new URL(path, import.meta.url),'utf8');
const files = readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(p=>p.endsWith('_contiguity_sender_volume.sql'));
assert.equal(files.length,1);
const pg=await PGlite.create();
const exec=sql=>pg.exec(sql);
const one=async(sql,params=[])=>Object.values((await pg.query(sql,params)).rows[0])[0];
const sender='+14155550100', other='+16195550101';
const owner=await one("select md5('owner')::uuid");
const room=(cold=true,market='TX/active',number=sender,account=owner)=>one('select icash_sender_private.room($1,$2,$3,$4)',[number,cold,account,market]);
const make=async key=>one('select fixture_message($1,fixture_thread($1))',[key]);
const claim=id=>one('select public.icash_claim_text($1,$2,$3)',[owner,id,sender]);
const uses=(source,id)=>one('select count(*)::int from icash_sender_private.uses where source=$1 and source_id=$2',[source,id]);
const seedUses=(n,cold,key)=>pg.query("insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) select 'fixture',md5($1||i)::uuid,$2,$3,now() from generate_series(1,$4::int) i",[key,sender,cold,n]);
try {
 await exec(read('fixtures/contiguity-volume-predecessors.sql')+read('fixtures/contiguity-volume-admission.sql'));
 const historical=await make('previous');
 await pg.query("update public.icash_text_messages set state='accepted',provider_id='original' where id=$1",[historical]);
 await pg.query("insert into public.icash_operation_spend(operation_key,account_id,dispatched_at) values('text:'||$1::text,$2,now()-interval '2 hours')",[historical,owner]);
 const held=await make('waiting');
 await exec(read('../supabase/migrations/'+files[0]));
 assert.equal(await uses('property',historical),1,'Deployment accounts for earlier use');
 assert.equal(await uses('property',held),0,'An unstarted message takes no slot');
 for(const role of ['anon','authenticated']){
  assert.equal(await one("select has_schema_privilege($1,'icash_sender_private','usage')",[role]),false);
  assert.equal(await one("select has_function_privilege($1,'public.icash_next_sender_volume_retry()','execute')",[role]),false);
 }
 await seedUses(99,true,'low');
 assert.equal(await room(),false);assert.equal(await room(true,'TX/active',other),true);
 assert.equal(await room(false),true,'Transactional work can use the shared headroom');
 const contract=await make('signature');
 await pg.query("insert into public.icash_contract_text_deliveries(message_id,thread_id,account_id) select id,thread_id,account_id from public.icash_text_messages where id=$1",[contract]);
 assert.deepEqual(await claim(contract),{from:sender});assert.equal(await one("select cold from icash_sender_private.uses where source='property' and source_id=$1",[contract]),false);

 assert.equal(await claim(held),null);
 assert.equal(await one("select count(*)::int from public.icash_operation_spend where operation_key='text:'||$1::text",[held]),0);
 assert.equal(await one("select state from public.icash_text_messages where id=$1",[held]),'ready');
 assert.equal(await one('select count(*)::int from icash_sender_private.waiting'),1);
 await exec("update icash_sender_private.waiting set next_check_at=now()-interval '1 second'");
 assert.equal(await one('select public.icash_next_sender_volume_retry()'),null,'A queued retry cannot bypass its number');
 // The score requires 50 distinct attempted recipients on this list. Four real
 // replies plus STOP, duplicates, old provider events and wrong-line events fail.
 await exec(`insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at,account_id,thread_id,cohort,opener)
  select 'property',md5('sample'||i)::uuid,'+14155550100',true,now()-interval '2 days',md5('owner')::uuid,fixture_thread('sample'||i),'TX/active',true from generate_series(1,50)i;
  insert into public.icash_text_messages(id,thread_id,account_id,direction,state,provider_id,body,created_at)
  select source_id,thread_id,account_id,'outgoing','accepted','send-'||source_id,'Hello',admitted_at from icash_sender_private.uses where opener;`);
 async function reply(i,body,variant='good'){
  const key=i+'-'+variant;
  await pg.query(`with hit as (select t.*,u.admitted_at+interval '10 minutes' as reply_time from icash_sender_private.uses u join public.icash_text_threads t on t.id=u.thread_id where u.source_id=md5('sample'||$1::text)::uuid)
   insert into public.icash_text_events(id,type,payload,received_at)
   select $2,'text.incoming.sms',jsonb_build_object('id',$2::text,'type','text.incoming.sms','timestamp',extract(epoch from reply_time)-case when $4='old' then 86400 else 0 end,
   'data',jsonb_build_object('from',recipient,'to',case when $4='wrong' then '+16195550101' else sender end,'body',$3::text)),reply_time from hit`,[i,key,body,variant]);
  await pg.query(`insert into public.icash_text_messages(id,thread_id,account_id,direction,state,body,event_id,created_at)
   select md5($2)::uuid,thread_id,account_id,'incoming','received',$3,$2,admitted_at+interval '10 minutes' from icash_sender_private.uses where source_id=md5('sample'||$1::text)::uuid`,[i,key,body]);
 }
 for(let i=1;i<=4;i++)await reply(i,'What is your offer?');
 await reply(1,'Yes I am interested','another');await reply(5,'STOP');await reply(6,'What is your offer?','wrong');await reply(7,'What is your offer?','old');
 assert.equal(await room(),false);
 await reply(8,'How much would you offer?');
 assert.equal(await room(),true);assert.equal(await room(true,'FL/active'),false);assert.equal(await room(true,'TX/active',sender,null),false);
 await seedUses(200,true,'strong');
 assert.equal(await room(),false,'Even a responsive list stops at 300');assert.equal(await room(false),true);
 await seedUses(699,false,'service');
 assert.equal(await room(false),false,'The 1,000 total includes cold and service traffic');
 await exec("update icash_sender_private.waiting set next_check_at=now()-interval '1 minute';update icash_sender_private.uses set admitted_at=now()-interval '25 hours' where source='fixture';");
 await exec("update public.icash_accounts set bot_paused=true");
 assert.equal(await one('select public.icash_next_sender_volume_retry()'),null);
 await exec("update public.icash_accounts set bot_paused=false;update icash_sender_private.waiting set next_check_at=now()-interval '1 second'");
 assert.deepEqual(await one('select public.icash_next_sender_volume_retry()'),{accountId:owner,messageId:held,claimKind:'automatic'});
 assert.deepEqual(await claim(held),{from:sender});assert.equal(await claim(held),null);
 assert.equal(await uses('property',held),1);assert.equal(await one('select count(*)::int from icash_sender_private.waiting'),0);
 // A manual or provider-unknown attempt cannot turn into a fresh automatic send.
 assert.equal(await one("select count(*)::int from public.icash_operation_spend where operation_key='text:'||$1::text",[held]),1);
 await exec("update public.icash_text_messages set state='needs_review' where id=md5('messagewaiting')::uuid");
 assert.equal(await one('select public.icash_next_sender_volume_retry()'),null);

 // Exercise the actual access / campaign authorizations on this same number.
 await seedUses(1000,false,'again');
 await exec(`insert into public.icash_purchase_phone_challenges(id,membership_id,email,phone,sender,status,secret_hash,expires_at)
 values(md5('code')::uuid,md5('membership')::uuid,'fixture@example.invalid','+12025550111','+14155550100','pending','fixture',now()+interval '10 minutes');
 insert into public.icash_legacy_outbox(id,channel,state,sender,revision) values(md5('legacy')::uuid,'sms','sending','+14155550100',1);`);
 assert.equal(await one("select public.icash_authorize_phone_challenge(md5('code')::uuid,'fixture')"),false);
 assert.equal(await one("select public.icash_legacy_authorize(md5('legacy')::uuid)"),null);
 assert.equal(await one("select state from public.icash_legacy_outbox where id=md5('legacy')::uuid"),'queued');
 await exec("delete from icash_sender_private.uses where source='fixture' and admitted_at>now()-interval '1 hour'");
 assert.equal(await one("select public.icash_authorize_phone_challenge(md5('code')::uuid,'fixture')"),true);
 assert.equal(await one("select public.icash_authorize_phone_challenge(md5('code')::uuid,'fixture')"),false);
 console.log('PASS full sender-volume migration, historical spend, rolling mixed traffic, verified reply cohorts, strict limits, protected retry, access and campaign grants');
} finally {await pg.close();}

// A deferred Meta/manual job still requires exactly its original dispatch path.
const savedEnv={...process.env};
try{
 Object.assign(process.env,{ICASH_SMS_WORK_READY:'true',CONTIGUITY_API_KEY:'fixture',CONTIGUITY_WEBHOOK_SECRET:'fixture'});
 let claims=0,providerCalls=0;
 const api=await loadService('lib/text-message-service.ts',{
  instantLeadsEnabled:()=>false,smsWorkEnabled:()=>true,liveWorkReady:()=>true,sameBusinessNumber:(a,b)=>a===b,textPayload:()=>({}),SellerInventoryUnavailableError:class extends Error{},
  db:async(path)=>{
   if(path==='rpc/icash_next_sender_volume_retry')return {accountId:owner,messageId:'fixture',claimKind:'meta'};
   if(path.startsWith('icash_text_messages?'))return [{body:'fixture',thread_id:'thread',attachments:[]}];
   if(path.startsWith('icash_text_threads?'))return [{recipient:'+12025550100',sender}];
   if(path.startsWith('icash_text_senders?'))return [{phone:sender}];
   if(path.startsWith('icash_voice_configs?'))return [];
   claims++;throw Error('Unexpected claim');
  },sendContiguityText:async()=>{providerCalls++;throw Error('No live transport');}
 });
 assert.equal((await api.retryVolumeDeferredText()).status,'message_held');assert.equal(claims,0);assert.equal(providerCalls,0);
}finally{Object.assign(process.env,savedEnv);for(const k of Object.keys(process.env))if(!(k in savedEnv))delete process.env[k];}
