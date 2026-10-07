import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function verifyWebinarFollowups(q,config){
 const scalar=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
 const make=async({preview=false,email=true,sms=true,phone='2125550100',address}={})=>{
  const id=randomUUID(),session=randomUUID(),recipient=address??`${id}@example.invalid`;
  await q('insert into icash_webinar_visitors(id) values($1)',[id]);
  await q('select icash_webinar_begin($1,$2,$3,$4)',[id,session,config,preview]);
  await q('select icash_webinar_contact_followups($1,$2,$3,$4,$5,$6,$7)',[id,session,'Casey Smith',recipient,phone,email,sms]);
  return {id,session,recipient,phone};
 };
 const jobs=async(v)=>(await q('select * from icash_webinar_outbox where visitor_id=$1 order by step',[v.id])).rows;
 const claim=async(email=true,sms=true)=>(await q('select * from icash_webinar_claim_followups($1,$2)',[email,sms])).rows;
 const age=async(v)=>q("update icash_webinar_visitors set last_seen_at=now()-interval '20 minutes' where id=$1",[v.id]);
 const due=async(v)=>q("update icash_webinar_outbox set due_at=now()-interval '1 minute' where visitor_id=$1",[v.id]);
 const authorize=async(id,payload={subject:'Stable content'})=>scalar('select to_jsonb(icash_webinar_authorize_followup($1,$2))',[id,payload]);
 const clear=async()=>q("update icash_webinar_outbox set state='canceled' where state in ('pending','claimed','sending')");
 const a=await make();assert.equal((await jobs(a)).length,5);assert.equal(await scalar('select phone from icash_webinar_visitors where id=$1',[a.id]),'+12125550100');
 assert.equal(await scalar("select count(*)::int from icash_webinar_followups where visitor_id=$1 and state='pending'",[a.id]),0,'Legacy email sequence cannot double-send');
 await q('select icash_webinar_contact_followups($1,$2,$3,$4,$5,true,true)',[a.id,a.session,'Casey',a.recipient,a.phone]);assert.equal((await jobs(a)).length,5,'Repeat contact cannot restart the sequence');
 const duplicate=await make({address:a.recipient});assert.equal((await jobs(duplicate)).length,0,'Recipient dedupe works across visitors');
 const preview=await make({preview:true,phone:'2125550102'});assert.equal((await jobs(preview)).length,0);
 const onlyEmail=await make({sms:false,phone:'2125550103'});assert.deepEqual((await jobs(onlyEmail)).map(j=>j.channel),['email','email','email']);
 const onlySms=await make({email:false,phone:'2125550104'});assert.deepEqual((await jobs(onlySms)).map(j=>j.channel),['sms','sms']);
 await due(a);assert.equal((await claim()).length,0,'An actively watching viewer gets no follow-up');await age(a);
 let leased=await claim(false,true);assert.equal(leased.length,2);assert.ok(leased.every(j=>j.channel==='sms'));assert.equal((await claim(false,true)).length,0,'An active lease is not shared');
 const first=await authorize(leased[0].id);assert.equal(first.state,'sending');assert.equal(await authorize(leased[0].id),null,'Send authorization is one-use');
 assert.equal(await authorize(leased[1].id),null,'Concurrent channels wait their turn');
 await q("update icash_webinar_outbox set claimed_at=now()-interval '6 minutes' where id=$1",[leased[0].id]);await claim(false,true);
 assert.equal(await scalar('select state from icash_webinar_outbox where id=$1',[leased[0].id]),'unknown','Ambiguous SMS is never retried');
 await clear();
 const payer=await make({phone:'2125550105'});await age(payer);await due(payer);leased=await claim();
 await q("insert into icash_funding_orders(id,mode,state,payer_email) values($1,'live','paid',$2)",[randomUUID(),payer.recipient]);
 assert.equal(await authorize(leased[0].id),null,'Purchase between claim and dispatch stops the send');await claim();assert.ok((await jobs(payer)).every(j=>j.state==='canceled'));
 const retry=await make({sms:false,phone:''});await age(retry);await due(retry);leased=await claim();
 const emailJob=leased[0];assert.equal((await authorize(emailJob.id)).payload.subject,'Stable content');
 await q("update icash_webinar_outbox set claimed_at=now()-interval '6 minutes' where id=$1",[emailJob.id]);await claim();
 assert.equal((await authorize(emailJob.id,{subject:'Changed content'})).payload.subject,'Stable content','Retries keep the original provider payload');
 await q("select icash_webinar_followup_delivery('email','receipt-before-send','bounced')");
 await q("select icash_webinar_finish_followup($1,'receipt-before-send')",[emailJob.id]);
 assert.equal(await scalar('select state from icash_webinar_outbox where id=$1',[emailJob.id]),'failed');
 assert.equal(await scalar('select count(*)::int from icash_webinar_suppressions where email=$1',[retry.recipient]),1,'Early bounce receipt is applied atomically on send completion');
 assert.ok((await jobs(retry)).filter(j=>j.id!==emailJob.id).every(j=>j.state==='canceled'));
 await q("select icash_webinar_followup_delivery('email','receipt-before-send','delivered')");assert.equal(await scalar("select kind from icash_webinar_delivery_receipts where provider_id='receipt-before-send'"),'bounced','Out-of-order success cannot erase a suppression');
 await clear();
 const frequency=await make({phone:'2125550106'});await age(frequency);await due(frequency);leased=await claim();
 const steps=Object.fromEntries(leased.map(j=>[j.step,j]));await authorize(steps[0].id);await q("select icash_webinar_finish_followup($1,'email-one')",[steps[0].id]);assert.equal(await authorize(steps[1].id),null,'At least an hour between messages');
 await q("update icash_webinar_outbox set sent_at=now()-interval '2 hours' where id=$1",[steps[0].id]);assert.ok(await authorize(steps[2].id));await q("select icash_webinar_finish_followup($1,'email-two')",[steps[2].id]);
 await q("update icash_webinar_outbox set sent_at=now()-interval '2 hours' where id=$1",[steps[2].id]);assert.equal(await authorize(steps[3].id),null,'Two messages per rolling 24 hours across channels');
 await q("select icash_webinar_text_reply('+12125550106',true)");assert.ok((await jobs(frequency)).filter(j=>j.channel==='sms').every(j=>j.state==='canceled'));
 const stopped=await make({email:false,phone:'2125550106'});assert.equal((await jobs(stopped)).length,0,'STOP applies across new visits');await clear();
 const expired=await make({sms:false,phone:''});await age(expired);await due(expired);await q("update icash_webinar_outbox set first_attempt_at=now()-interval '21 hours' where visitor_id=$1",[expired.id]);assert.equal((await claim()).length,0);assert.ok((await jobs(expired)).every(j=>j.state==='failed'),'Do not retry beyond provider idempotency retention');
 const fourth=await make({sms:false,phone:''});await age(fourth);await due(fourth);leased=await claim();await authorize(leased[0].id);await q('update icash_webinar_outbox set attempts=4 where id=$1',[leased[0].id]);await claim();assert.equal(await scalar('select state from icash_webinar_outbox where id=$1',[leased[0].id]),'sending','A live fourth attempt is not expired by an overlapping cron');
 for(const role of ['anon','authenticated']){
  assert.equal(await scalar("select has_table_privilege($1,'icash_webinar_outbox','select')",[role]),false);
  assert.equal(await scalar("select has_function_privilege($1,'icash_webinar_finish_followup(uuid,text)','execute')",[role]),false);
 }
 console.log('Follow-up database checks passed: consent, dedupe, preview exclusion, inactivity, one-use claims, payment suppression, retries, receipt races, frequency, STOP and grants.');
}
