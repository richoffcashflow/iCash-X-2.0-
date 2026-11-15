import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export async function runSellerTerminalReceiptTests({pg,q,one,isolated,a,b,screen,deal,thread,phone,hash,call,outgoing,manualText,ai,reservedJob,mail,allowed,emit}){
 await pg.exec(`
 alter table icash_live_conversations add column operation_key text,add column conversation_id text;
 alter table icash_seller_agreement_private.call_history add column conversation_id text;
 create table public.icash_call_recordings(id uuid primary key,account_id uuid,operation_key text,screening_id uuid,party text,call_context jsonb,call_sid text,recording_sid text,conversation_id text,to_phone text,contact_key text,end_requested_at timestamptz,last_action text);
 create schema icash_recorded_reception_private;
 create table icash_recorded_reception_private.sessions(id uuid primary key,account_id uuid,operation_key text,call_sid text,recording_sid text,conversation_id text,from_phone text,contact_key text,end_requested_at timestamptz,last_action text,register_claimed_at timestamptz);
 create table icash_seller_agreement_private.inbound_bindings(session_id uuid primary key,account_id uuid,deal_id uuid,thread_id uuid);
 create or replace function public.icash_transition_call_recording(p_id uuid,p_account uuid,p_operation text,p_expected_state text,p_action text,p_payload jsonb) returns jsonb language plpgsql as $$
 declare r public.icash_call_recordings;
 begin
 select * into r from public.icash_call_recordings where id=p_id and account_id=p_account and operation_key=p_operation for update;
 if p_action='stop' then update public.icash_call_recordings set last_action='stop',end_requested_at=coalesce(end_requested_at,clock_timestamp()) where id=r.id;end if;
 return to_jsonb(r);
 end $$;
 create function public.icash_transition_recorded_reception(p_id uuid,p_account uuid,p_operation text,p_expected_version bigint,p_action text,p_payload jsonb) returns jsonb language plpgsql as $$
 declare r icash_recorded_reception_private.sessions;
 begin
 select * into r from icash_recorded_reception_private.sessions where id=p_id and account_id=p_account and operation_key=p_operation for update;
 if p_action='stop' then update icash_recorded_reception_private.sessions set last_action='stop',end_requested_at=coalesce(end_requested_at,clock_timestamp()) where id=r.id;end if;
 return to_jsonb(r);
 end $$;`);
 const setup=async(kind,account=a,recipient=phone)=>{
  const id=randomUUID(),operation='voice:'+id,conversation='conv_'+id.replaceAll('-','');
  if(kind==='call'){
   await q("insert into icash_call_recordings values($1,$2,$3,$4,'seller','{}','CAfixture','REfixture',$5,$6,$7,null,'recording')",[id,account,operation,screen,conversation,recipient,hash]);
   await q('update icash_live_conversations set operation_key=$2,conversation_id=$3 where id=$1',[call,operation,conversation]);
  }else{
   await q("insert into icash_recorded_reception_private.sessions values($1,$2,$3,'CAfixture','REfixture',$4,$5,$6,null,'recording',now())",[id,account,operation,conversation,recipient,hash]);
   await q('insert into icash_seller_agreement_private.inbound_bindings values($1,$2,$3,$4)',[id,account,deal,thread]);
  }
  const stop=()=>q(kind==='call'?"select icash_transition_call_recording($1,$2,$3,'recording','stop','{}')":"select icash_transition_recorded_reception($1,$2,$3,1,'stop','{}')",[id,account,operation]);
  const result=async body=>{
   const transcript=[{role:'agent',message:'Would you consider selling for cash?'},{role:'user',message:body}];
   if(kind==='call')await q('select icash_save_live_result($1,$2)',[call,{transcript,optedOut:false}]);
   else await q('insert into icash_seller_agreement_private.call_history(session_id,account_id,screening_id,contact_key,completed_at,transcript,conversation_id) values($1,$2,$3,$4,now(),$5,$6)',[id,account,screen,hash,JSON.stringify(transcript),conversation]);
  };
  return {id,operation,conversation,stop,result};
 };
 // Reproduce final-send admission while the carrier is stopped but the source
 // transcript has not yet arrived. No source disposition can exist at this point.
 if(!emit)await isolated(async()=>{const s=await setup('call');await s.stop();assert.equal(await allowed('text:'+outgoing),true,'reproduced old post-hangup/pre-transcript send window');assert.equal(await allowed('deal-email:'+mail),true,'reproduced queued automatic email window');});
 await pg.exec(read('config/seller-terminal-receipt-wait.sql'));
 if(emit){emit();return;}
 for(const kind of ['call','inbound_call'])for(const body of ['The price is too low','Fuck off. Who is this?'])await isolated(async()=>{
  const s=await setup(kind);await s.stop();
  for(const op of ['text:'+outgoing,'sms-ai:'+ai,'voice:'+reservedJob,'deal-email:'+mail])assert.equal(await allowed(op),false,'original transcript pending: '+kind+' '+op);
  assert.equal(await allowed('text:'+manualText),true,'existing manual scope remains distinct');
  await q('savepoint unrelated_email');await q("update icash_deal_emails set recipient='unrelated@example.invalid' where id=$1",[mail]);
  assert.equal(await allowed('deal-email:'+mail),true,'a stopped phone does not guess an unrelated email');
  await q('rollback to savepoint unrelated_email');await q('release savepoint unrelated_email');
  assert.equal((await one('select icash_seller_terminal_receipt_pending($1,$2) p',[b,phone])).p,false,'no account-wide hold');
  assert.equal((await one('select icash_seller_terminal_receipt_pending($1,$2) p',[a,'+12145550999'])).p,false,'no other phone hold');
  assert.equal((await one('select count(*) n from icash_text_suppressions')).n,0,'pending receipt never invents optout');
  await s.stop();assert.equal((await one('select count(*) n from icash_seller_agreement_private.terminal_receipt_waits')).n,1,'repeated stop idempotent');
  await s.result(body);
  assert.equal((await one('select icash_seller_terminal_receipt_pending($1,$2) p',[a,phone])).p,false,'canonical source resolves only original wait');
  assert.equal(await allowed('text:'+outgoing),!body.startsWith('Fuck'),'hard stop suppression persists after wait resolves');
  const receipt=await one('select * from icash_seller_agreement_private.terminal_receipt_waits');assert.ok(receipt.receipt_id);assert.ok(receipt.resolved_at);
  if(kind==='inbound_call')await q('delete from icash_seller_agreement_private.call_history where session_id=$1',[s.id]);
  else await q('delete from icash_live_conversations where id=$1',[call]);
  assert.equal((await one('select icash_seller_terminal_receipt_pending($1,$2) p',[a,phone])).p,false,'ordinary history retention never reopens a resolved hold');
 });
 for(const kind of ['call','inbound_call'])await isolated(async()=>{
  const s=await setup(kind);await s.result('The price is too low');await s.stop();
  assert.equal((await one('select icash_seller_terminal_receipt_pending($1,$2) p',[a,phone])).p,false,'receipt-before-stop race records resolved source');
 });
 await isolated(async()=>{
  const s=await setup('call');await s.stop();
  await q("insert into icash_live_conversations(id,account_id,screening_id,contact_key,party,state,result,completed_at,operation_key,conversation_id) values($1,$2,$3,$4,'seller','complete','{}',now(),'voice:foreign','conv_foreign')",[randomUUID(),a,screen,hash]);
  assert.equal(await allowed('text:'+outgoing),false,'unrelated result cannot release wait');
 });
 await isolated(async()=>{
  const s=await setup('call');await q("update icash_call_recordings set end_requested_at=(select installed_at-interval '1 second' from icash_seller_agreement_private.terminal_receipt_policy) where id=$1",[s.id]);await s.stop();
  assert.equal((await one('select count(*) n from icash_seller_agreement_private.terminal_receipt_waits')).n,0,'no historical stop backfill');
 });
 assert.equal(read('config/seller-terminal-receipt-wait.sql'),read('supabase/migrations/20261115213633_seller_terminal_receipt_wait.sql'));
 console.log('Seller terminal receipt waits passed: reproduced final-send window, both call directions, exact source resolution, hard-stop suppression, ordinary price objection, prospective and retention boundaries.');
}
