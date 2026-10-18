import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

export async function verifyWebinarExitRecovery(pg,q,config){
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261018045440_webinar_immediate_exit_recovery.sql',import.meta.url),'utf8'));
 const scalar=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
 await q("update icash_webinar_outbox set state='canceled' where state in ('pending','claimed','sending')");
 await q("update icash_messaging_settings set config=config||'{\"enabled\":true,\"smsEnabled\":true,\"postalAddress\":\"123 Test Street\"}'::jsonb");
 await q("insert into icash_webinar_text_senders(phone,enabled) values('+12125550999',true) on conflict(phone) do update set enabled=true");
 let phone=1000;
 const make=async({email=true,sms=true,preview=false,legacy=false}={})=>{
  const v={id:randomUUID(),session:randomUUID(),page:randomUUID(),email:randomUUID()+'@example.invalid',phone:'+1212555'+String(phone++),seq:0};
  await q("insert into icash_webinar_visitors(id,timezone) values($1,(select name from pg_timezone_names where extract(hour from now() at time zone name)=2 limit 1))",[v.id]);
  await q('insert into icash_webinar_sessions(id,visitor_id,webinar_id,revision,config,is_preview) values($1,$2,$3,1,$4,$5)',[v.session,v.id,config.id,config,preview]);
  await q(`select ${legacy?'icash_webinar_contact_ongoing_campaign':'icash_webinar_contact_exit_campaign'}($1,$2,'Alex',$3,$4,$5,$6)`,[v.id,v.session,v.email,v.phone,email,sms]);
  v.sender=await scalar('select icash_webinar_campaign_sender($1)',[v.phone]);return v;
 };
 const signal=(v,state,page=v.page,sequence=++v.seq)=>scalar('select icash_webinar_recovery_signal($1,$2,$3,$4,$5)',[v.id,v.session,page,sequence,state]);
 const jobs=async(v)=>(await q('select * from icash_webinar_outbox where visitor_id=$1 and departure_id is not null order by created_at,channel',[v.id])).rows;
 const due=async(v)=>q("update icash_webinar_outbox set due_at=now()-interval '1 second' where visitor_id=$1 and departure_id is not null and state='pending'",[v.id]);
 const claim=async(v)=>(await q('select * from icash_webinar_claim_followups(true,true)')).rows.filter(j=>j.visitor_id===v.id);
 const authorize=(v,j,payload={from:v.sender,message:'Come back',subject:'Come back'})=>scalar('select to_jsonb(icash_webinar_authorize_followup($1,$2))',[j.id,payload]);
 const finish=(j)=>q('select icash_webinar_finish_followup($1,$2)',[j.id,'fixture-'+j.id]);
 const a=await make();await signal(a,'active');assert.equal(await signal(a,'left'),true);
 assert.equal((await jobs(a)).length,2,'One email and one SMS per departure');
 assert((await jobs(a)).every(j=>j.due_at.getTime()-j.created_at.getTime()===5000),'Only a five-second return grace');
 assert.equal((await claim(a)).length,0,'Never send before grace ends');
 assert.equal(await signal(a,'left',a.page,a.seq),false,'Replay is idempotent');
 assert.equal(await signal(a,'left'),false,'Duplicate hidden/pagehide does not add a pair');
 // A final playback beacon is not evidence of a return.
 await q("select icash_webinar_record($1,$2,10,'progress','once')",[a.id,a.session]);await due(a);
 let leased=await claim(a);assert.equal(leased.length,2,'Recent playback and 2 AM local time do not postpone a departure');
 for(const j of leased){assert.equal((await authorize(a,j)).state,'sending');assert.equal(await authorize(a,j),null,'One-use send authorization');await finish(j);}
 assert((await jobs(a)).every(j=>j.state==='sent'),'Email and SMS do not cancel each other');
 assert.equal(await scalar("select count(*)::int from icash_webinar_outbox where visitor_id=$1 and step=300000 and state='pending'",[a.id]),0,'No extra first-round backlog');
 await signal(a,'active');assert.equal(await signal(a,'left'),true,'A later real exit sends another pair for ongoing consent');await due(a);leased=await claim(a);assert.equal(leased.length,2);
 for(const j of leased){assert(await authorize(a,j));await finish(j);}
 // Existing limited SMS permission cannot be silently extended by the new trigger.
 await q("update icash_webinar_visitors set sms_consent_version='webinar-sms-v1' where id=$1",[a.id]);
 await signal(a,'active');await signal(a,'left');assert.equal((await jobs(a)).filter(j=>j.state==='pending'&&j.channel==='sms').length,0);
 await signal(a,'active');

 const legacy=await make({legacy:true});assert.equal(await scalar("select icash_webinar_exit_consent($1,'sms')",[legacy.id]),false,'Older opt-in is not silently upgraded');
 await signal(legacy,'active');await signal(legacy,'left');await due(legacy);leased=await claim(legacy);
 for(const j of leased){assert(await authorize(legacy,j));await finish(j);}
 await signal(legacy,'active');await signal(legacy,'left');await due(legacy);leased=await claim(legacy);
 for(const j of leased)assert.equal(await authorize(legacy,j),null,'Earlier daily limits still apply');await signal(legacy,'active');

 const quick=await make();await signal(quick,'active');await signal(quick,'left');await signal(quick,'active');await due(quick);assert.equal((await claim(quick)).length,0,'Quick return cancels both');
 assert.equal(await signal(quick,'left',quick.page,2),false,'A late exit beacon cannot undo a newer return');
 const refresh=await make();await signal(refresh,'active');await signal(refresh,'left');await signal(refresh,'active',randomUUID(),1);await due(refresh);assert.equal((await claim(refresh)).length,0,'A fresh document cancels the old document departure');
 const tabs=await make();const tab2=randomUUID();await signal(tabs,'active');await signal(tabs,'active',tab2,1);assert.equal(await signal(tabs,'left'),false,'Leaving one tab while another is active sends nothing');
 assert.equal(await signal(tabs,'left',tab2,2),true,'The last active tab leaving queues the pair');await signal(tabs,'active',tab2,3);
 const checkout=await make();await signal(checkout,'active');await signal(checkout,'left');await due(checkout);leased=await claim(checkout);assert.equal(leased.length,2);await signal(checkout,'checkout');for(const j of leased)assert.equal(await authorize(checkout,j),null,'Checkout between claim and send cancels');

 for(const opt of [{email:false,sms:true},{email:true,sms:false},{email:false,sms:false}]){
  const v=await make(opt);await signal(v,'active');await signal(v,'left');const pending=(await jobs(v)).filter(j=>j.state==='pending');
  assert.deepEqual(pending.map(j=>j.channel).sort(),[...(opt.email?['email']:[]),...(opt.sms?['sms']:[])]);await signal(v,'active');
 }
 const stopped=await make();await signal(stopped,'active');await signal(stopped,'left');await due(stopped);leased=await claim(stopped);
 await q('insert into icash_text_suppressions(phone) values($1)',[stopped.phone]);
 assert.equal(await authorize(stopped,leased.find(j=>j.channel==='sms')),null,'Last-moment STOP/global suppression blocks SMS');await signal(stopped,'active');
 const paid=await make();await signal(paid,'active');await signal(paid,'left');await due(paid);leased=await claim(paid);
 await q("insert into icash_funding_orders(id,mode,state,payer_email) values($1,'live','paid',$2)",[randomUUID(),paid.email]);for(const j of leased)assert.equal(await authorize(paid,j),null,'Purchase between claim and send blocks both');
 const preview=await make({preview:true});assert.equal(await signal(preview,'left'),false);assert.equal((await jobs(preview)).length,0);
 assert.equal(await scalar('select count(*)::int from icash_webinar_recovery_consents where visitor_id=$1',[preview.id]),0,'Preview never accepts a new consent version');
 const customer=await make(),user=randomUUID(),account=randomUUID();
 await q('insert into auth.users values($1,$2,now())',[user,customer.email]);await q('insert into icash_accounts(id,owner_user_id,contact_phone) values($1,$2,$3)',[account,user,customer.phone]);
 await q("insert into icash_memberships(id,account_id,mode,state,payer_email,payer_phone,paid_through) values($1,$2,'live','active',$3,$4,now()+interval '30 days')",[randomUUID(),account,customer.email,customer.phone]);
 await q('update icash_customer_update_settings set enabled=true');await q('select icash_webinar_activate_customers()');
 assert.deepEqual((await q('select email_enabled,sms_enabled from icash_customer_update_preferences where account_id=$1',[account])).rows[0],{email_enabled:true,sms_enabled:true},'New opt-ins still transition to the selected customer updates after verified purchase');
 await assert.rejects(()=>q("select icash_webinar_recovery_signal($1,$2,$3,1,'left')",[a.id,preview.session,randomUUID()]),/Session not found/);
 await assert.rejects(()=>signal(quick,'active',a.page,100),/Page does not belong/);

 const retry=await make();await signal(retry,'active');await signal(retry,'left');await due(retry);leased=await claim(retry);
 for(const j of leased)assert(await authorize(retry,j));
 await q("update icash_webinar_outbox set claimed_at=now()-interval '6 minutes' where visitor_id=$1 and departure_id is not null",[retry.id]);
 leased=await claim(retry);assert.equal(leased.length,1);assert.equal(leased[0].channel,'email');
 assert.equal((await authorize(retry,leased[0],{subject:'Changed'})).payload.subject,'Come back','Safe email retry keeps the original payload');
 assert.equal((await jobs(retry)).find(j=>j.channel==='sms').state,'unknown','Ambiguous SMS never retries');
 const paused=await make();await signal(paused,'active');await signal(paused,'left');await due(paused);leased=await claim(paused);
 await q("update icash_messaging_settings set config=config||'{\"enabled\":false,\"smsEnabled\":false}'::jsonb");for(const j of leased)assert.equal(await authorize(paused,j),null,'Owner channel disable is still honored');
 for(const role of ['anon','authenticated']){
  for(const table of ['icash_webinar_recovery_presence','icash_webinar_departures','icash_webinar_recovery_consents'])assert.equal(await scalar('select has_table_privilege($1,$2,\'select\')',[role,table]),false);
  assert.equal(await scalar("select has_function_privilege($1,'icash_webinar_recovery_signal(uuid,uuid,uuid,bigint,text)','execute')",[role]),false);
 }
 assert.equal((await q('select * from icash_webinar_return_steps()')).rows.length,6,'Three bounded paired rounds, no weekly reenrollment');
 console.log('PASS immediate webinar recovery: overnight paired sends, five-second grace, repeat exits, consent, payment/STOP, refresh, checkout, tabs, reordered beacons and safe retries.');
}
