// Application/provenance assertions only. New paid receipts are synthetic settled
// fixtures; acquisition billing and provider arithmetic have independent suites.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function verifyDiscoveryOpenerRefresh(f,{issuer=true}={}){
 const {q,one,rpc,account,thread,message,screening,oldContact,oldReceipt,nationalSource}=f;
 let cases=0;
 const scenario=async(name,run)=>f.isolated(async()=>{try{await run();cases++;}catch(error){throw new Error(name+': '+error.message,{cause:error});}});
 const sourceSnapshot=async()=>({
  owner:await one('select to_jsonb(x) value from icash_owner_contacts x where screening_id=$1',[screening]),
  receipt:await one('select to_jsonb(x) value from icash_dnc_verification_receipts x where id=$1',[oldReceipt]),
  contact:await one('select to_jsonb(x) value from icash_operational_contacts x where id=$1',[oldContact]),
  tickets:(await q('select to_jsonb(x) value from icash_automation_tickets x where opener_message_id=$1 order by id',[message])).rows,
  message:await one('select to_jsonb(x) value from icash_text_messages x where id=$1',[message]),
  operation:await one('select to_jsonb(x) value from icash_operation_spend x where operation_key=$1',['owners:'+account+':'+screening]),
 });
 await f.enable();
 await scenario('fresh evidence applies exactly once and never dispatches',async()=>{
  const before=await sourceSnapshot(),screenBefore=await one('select to_jsonb(s) value from icash_screening_jobs s where id=$1',[screening]);
  const r=await f.ready();assert.equal(await f.applyReview(r.review),true);
  assert.equal(await f.applyReview(r.review),false,'one-use review');
  const renewal=await one('select * from icash_discovery_refresh_private.renewals where id=$1',[r.id]);
  assert.equal(renewal.state,'applied');assert.deepEqual(renewal.original_snapshot.screening,screenBefore.value);
  assert.deepEqual(await sourceSnapshot(),before,'original purchases, contact, receipt, tickets and draft unchanged');
  assert.equal((await one('select count(*)::int n from icash_text_messages')).n,1);
  assert.equal((await one("select count(*)::int n from icash_operation_spend where operation_key='text:'||$1::text",[message])).n,0);
  assert.equal(await rpc('icash_sms_thread_review_current',{p_account:account,p_thread:thread,p_check_hour:false}),true,'unchanged actual final SMS guard accepts fresh evidence');
  await q('update icash_discovery_refresh_private.policy set enabled=false');
  assert.equal(await rpc('icash_operational_contact_current',{p_account:account,p_contact:renewal.successor_contact_id,p_channel:'sms',p_check_hour:false}),false,'disable holds new scope');
 });
 const changes=[
  ['account Pause',()=>q('update icash_accounts set bot_paused=true where id=$1',[account])],
  ['thread Pause',()=>q('update icash_text_threads set paused=true where id=$1',[thread])],
  ['manual takeover',()=>q('update icash_text_threads set manual_only=true where id=$1',[thread])],
  ['disabled original sender',()=>q('update icash_text_senders set enabled=false where phone=$1',[f.sender])],
  ['STOP',()=>q("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[f.phone])],
  ['source disabled',()=>q('update icash_dnc_verification_sources set enabled=false where id=$1',[nationalSource])],
  ['original receipt revoked',()=>q('update icash_dnc_verification_receipts set revoked_at=clock_timestamp() where id=$1',[oldReceipt])],
  ['contact revoked',()=>q('update icash_operational_contacts set revoked_at=clock_timestamp() where id=$1',[oldContact])],
  ['data rights expired',()=>q("update icash_discovery_configs set data_rights_until=clock_timestamp()-interval '1 second' where account_id=$1",[account])],
  ['sender identity drift',()=>q("update icash_customer_identities set company_name='SIMULATION changed business' where account_id=$1",[account])],
  ['new incoming response',()=>q("insert into icash_text_messages(account_id,thread_id,direction,body,state,event_id) values($1,$2,'incoming','SIMULATION new seller reply','received',$3)",[account,thread,randomUUID()])],
  ['unknown outgoing message',()=>q("insert into icash_text_messages(account_id,thread_id,direction,body,state) values($1,$2,'outgoing','SIMULATION uncertain','needs_review')",[account,thread])],
  ['exhausted original attempt cap',()=>q('update icash_automation_tickets set issue_attempts=3 where opener_message_id=$1',[message])],
  ['consumed original ticket',()=>q("update icash_automation_tickets set state='consumed' where opener_message_id=$1",[message])],
  ['renewal disabled',()=>q('update icash_discovery_refresh_private.policy set enabled=false')],
  ['activation identity drift',()=>q("update icash_discovery_refresh_private.policy set release_sha=repeat('b',40)")],
 ];
 for(const [name,change] of changes)await scenario(name+' wins after ready review',async()=>{
  const r=await f.ready(),original=await one('select to_jsonb(s) value from icash_screening_jobs s where id=$1',[screening]);
  await change();assert.equal(await f.applyReview(r.review),false);
  assert.deepEqual(await one('select to_jsonb(s) value from icash_screening_jobs s where id=$1',[screening]),original,'no stale evidence applied');
  assert.equal((await one('select operational_contact_id id from icash_text_threads where id=$1',[thread])).id,oldContact);
 });
 await scenario('unreviewed successor does not issue the original opener',async()=>{
  const r=await f.ready(undefined,{review:false});
  assert.equal((await one('select state from icash_discovery_refresh_private.renewals where id=$1',[r.id])).state,'ready');
  assert.equal((await one('select operational_contact_id id from icash_text_threads where id=$1',[thread])).id,oldContact,'staged successor never rebinds the original thread');
  assert.equal(await rpc('icash_recover_unstarted_seller_opener',{}),null,'ordinary issuer cannot consume unreviewed evidence');
  assert.equal((await one('select count(*)::int n from icash_discovery_refresh_private.applies')).n,0);
 });
 await scenario('ordinary acquisition cursor progress is not source drift',async()=>{const r=await f.ready();await q("update icash_discovery_configs set next_page=next_page+1,next_run_at=clock_timestamp()+interval '1 minute',inventory_refreshed_at=clock_timestamp() where account_id=$1",[account]);assert.equal(await f.applyReview(r.review),true);});
 await scenario('snapshot has no quality-choice mutation',async()=>{
  await q('update icash_research_private.list_quality_settings set enabled=true');
  const before=(await q('select * from icash_research_private.owner_sms_choices')).rows;
  assert.equal((await one('select icash_discovery_refresh_private.snapshot($1) value',[message])).value,null,'missing fixed phone choice held');
  assert.deepEqual((await q('select * from icash_research_private.owner_sms_choices')).rows,before);
 });
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'public.icash_apply_discovery_opener_refresh(uuid)','EXECUTE') allowed",[role])).allowed,false);
 if(issuer){
  // Ordinary scheduler runs AFTER the apply transaction has committed. PostgreSQL
  // now() is transaction-start, so freshness must be checked in its real next transaction.
  const originalTickets=(await q('select to_jsonb(t) value from icash_automation_tickets t where opener_message_id=$1 order by id',[message])).rows;
  assert.equal(await rpc('icash_recover_unstarted_seller_opener',{}),null,'stale original cannot receive a ticket');
  const r=await f.ready();assert.equal(await f.applyReview(r.review),true);
  const issued=await rpc('icash_recover_unstarted_seller_opener',{});assert(issued?.token,'actual original issuer admits fresh unchanged draft');
  const ticket=await one('select * from icash_automation_tickets where token=$1',[issued.token]);
  assert.equal(ticket.opener_message_id,message);assert.equal(ticket.issue_attempts,2);assert.equal(ticket.state,'issued');
  for(const original of originalTickets)assert.deepEqual(await one('select to_jsonb(t) value from icash_automation_tickets t where id=$1',[original.value.id]),original);
  assert.equal(await rpc('icash_recover_unstarted_seller_opener',{}),null,'no duplicate active ticket');
  assert.equal((await one("select count(*)::int n from icash_operation_spend where operation_key='text:'||$1::text",[message])).n,0);
  assert.equal((await one('select provider_id from icash_text_messages where id=$1',[message])).provider_id,null);
  cases++;
 }
 return {cases,description:'synthetic settled evidence; real snapshot, provenance, final guard, control holds and immutable originals; no provider calls'};
}
