// Execute retained SQL bodies, not an invented replacement of the reply guards.
// External permission and last-stage provider admission are fixture-only stubs.
export async function checkRetainedNoticeDelegates({pg,q,one,read,fn,patches,randomUUID,notice,account,deal,screening}) {
 await pg.exec(`set check_function_bodies=off;
 alter table icash_text_threads add operational_contact_id uuid,add dnc_checked_at timestamptz;
 alter table icash_sms_inbound_invitations add sender text,add recipient text,add deal_id uuid,add expires_at timestamptz,add called_number text;
 create table icash_seller_limited_text_replies(account_id uuid,thread_id uuid,source_id uuid unique,message_id uuid,action text,body text,created_at timestamptz default now());
 create table icash_contact_suppressions(contact_key text);
 create table icash_handoffs(account_id uuid,screening_id uuid,state text);
 create table icash_seller_viewing_availability(account_id uuid,thread_id uuid,source text,source_id uuid,state text);
 create function icash_seller_viewing_context(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create table icash_live_conversations(account_id uuid,screening_id uuid,contact_key text,state text,completed_at timestamptz,conversation_id uuid,result jsonb);
 create table icash_outreach_campaigns(account_id uuid);
 create table icash_contract_text_deliveries(account_id uuid,message_id uuid,envelope_id uuid);
 create schema icash_seller_agreement_private;
 create table icash_seller_agreement_private.confirmations(envelope_id uuid,account_id uuid,deal_id uuid);
 create schema icash_call_offer_private;
 create table icash_call_offer_private.offers(account_id uuid,deal_id uuid);
 create table icash_inbound_voice_routes(called_number text,business_number text,enabled boolean,reviewed_until timestamptz,agent_config_hash text);
 create function icash_confirmed_seller_contract_text_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_customer_authored_text(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_seller_recovery_nonprice_current(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_seller_conversation_message_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_sms_inbound_campaign_current(uuid) returns boolean language sql as $$select true$$;
 create function icash_buyer_package_data(uuid,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function icash_buyer_factual_text(uuid,uuid,text) returns text language sql as $$select null::text$$;
 create function icash_call_has_seller_response(jsonb) returns boolean language sql as $$select false$$;
 create function icash_claim_text_before_campaign(uuid,uuid,text) returns jsonb language sql as $$select '{"fixtureAdmission":true}'::jsonb$$;
 drop function icash_prepare_limited_seller_text(uuid,uuid,uuid);
 drop function icash_seller_limited_contact(uuid,uuid);
 create function icash_seller_limited_contact(uuid,uuid) returns boolean language sql as $$select true$$;
 `);
 await pg.exec(fn('config/reply-signals.sql','icash_text_signal'));
 await pg.exec(fn('config/seller-response-policy.sql','icash_seller_direct_response_match'));
 await pg.exec(fn('config/seller-response-policy.sql','icash_seller_response_disposition'));
 await pg.exec(fn('config/seller-conversation-continuation.sql','icash_seller_identity_question'));
 await pg.exec(fn('config/seller-conversation-continuation.sql','icash_seller_conversation_human'));
 await pg.exec(read('tests/fixtures/carrier-notice-delegates-before.sql'));
 await pg.exec(fn('config/seller-limited-text-replies.sql','icash_limited_seller_text_current'));
 const names=['icash_prepare_sms_inbound_reply','icash_seller_conversation_reply','icash_limited_seller_text_current','icash_seller_reply_before_viewings','icash_manual_handoff_reply','icash_prepare_limited_seller_text','icash_claim_text_before_buyer_package','icash_claim_text_before_owner_question','icash_seller_text_cadence_current'];
 const original=new Map();
 for(const patch of patches.filter(p=>names.some(n=>p.signature.startsWith('public.'+n+'(')))){
  const def=await one('select pg_get_functiondef($1::regprocedure)',[patch.signature]);
  if(!original.has(patch.signature))original.set(patch.signature,def);
  if(def.split(patch.old).length-1!==patch.count)throw Error('Unexpected delegate prerequisite '+patch.signature);
  await pg.exec(def.replaceAll(patch.old,patch.new));
 }
 await pg.exec('set check_function_bodies=on;');
 const assert=(await import('node:assert/strict')).default;
 const fresh=async()=>{
  const t=randomUUID(),sender='+12125550101',recipient='+1'+String(BigInt('0x'+randomUUID().replaceAll('-',''))%10000000000n).padStart(10,'0');
  await q('insert into icash_text_threads(id,account_id,deal_id,sender,recipient) values($1,$2,$3,$4,$5)',[t,account,deal,sender,recipient]);
  await q('insert into icash_sms_routes(sender,recipient,account_id) values($1,$2,$3)',[sender,recipient,account]);
  const put=(body,direction='incoming',state='received',provider=null)=>one('insert into icash_text_messages(account_id,thread_id,body,direction,state,event_id,provider_id) values($1,$2,$3,$4,$5,$6,$7) returning id',[account,t,body,direction,state,randomUUID(),provider]);
  return {t,sender,recipient,put};
 };
 // Ordinary acquisition continuation executes the retained implementation.
 const x=await fresh(),h=await x.put('The roof needs repairs.'),j=await one('select id from icash_text_ai_jobs where message_id=$1',[h]);
 await q("update icash_text_ai_jobs set state='drafted',analysis='{\"action\":\"ask_price\",\"facts\":[]}' where id=$1",[j]);
 const before=await one('select icash_seller_conversation_reply($1,$2)',[account,j]);assert.equal(before,'What price did you have in mind?');
 const late=await x.put(notice);assert.equal(await one('select icash_seller_conversation_reply($1,$2)',[account,j]),before,'Actual continuation survives late notice');
 const legacy=original.get('public.icash_seller_reply_before_viewings(uuid,uuid)');
 await pg.exec(legacy.replace('icash_seller_reply_before_viewings(', 'fixture_old_seller_reply('));
 assert.equal(await one('select fixture_old_seller_reply($1,$2)',[account,j]),null,'Regression reproduces original late-notice invalidation');
 const nj=await one("insert into icash_text_ai_jobs(account_id,thread_id,message_id,state,analysis) values($1,$2,$3,'drafted','{\"action\":\"ask_price\",\"facts\":[]}') returning id",[account,x.t,late]);
 assert.equal(await one('select icash_seller_conversation_reply($1,$2)',[account,nj]),null,'Historical notice itself never supplies acquisition dialogue');
 // Requested human handoff survives a newer notice but genuine STOP still wins.
 const handoff=await fresh();await handoff.put('I want a real person.');await q('update icash_text_threads set paused=true where id=$1',[handoff.t]);
 assert.equal(await one('select icash_manual_handoff_reply($1,$2)',[account,handoff.t]),true);await handoff.put(notice);
 assert.equal(await one('select icash_manual_handoff_reply($1,$2)',[account,handoff.t]),true);
 await handoff.put('STOP');assert.equal(await one('select icash_manual_handoff_reply($1,$2)',[account,handoff.t]),false);
 // Direct prepare cannot manufacture ask_payoff from historical notice and a
 // later notice cannot invalidate the genuine reply to the owner question.
 const limited=await fresh(),question=await limited.put('Are you the owner?','outgoing','delivered','fixture-question');
 await q('insert into icash_sms_seller_openings(account_id,thread_id,owner_question_id) values($1,$2,$3)',[account,limited.t,question]);
 const owner=await limited.put('Yes'),blocked=await limited.put(notice);
 assert.equal(await one('select icash_prepare_sms_inbound_reply($1,$2,$3)',[account,limited.t,blocked]),null);
 const payoff=await one('select icash_prepare_sms_inbound_reply($1,$2,$3)',[account,limited.t,owner]);assert(payoff,'Actual limited-contact delegate preserves genuine source');
 assert.equal(await one('select icash_limited_seller_text_current($1,$2)',[account,payoff]),true);
 assert.equal(await one('select source_id from icash_seller_limited_text_replies where message_id=$1',[payoff]),owner);
 // Owner-confirmation and invitation wrappers execute all real checks. Only the
 // final permission/provider function is stubbed; notice must not invalidate it.
 const invite=await fresh(),oq=await invite.put('Are you the owner?','outgoing','delivered','fixture-owner'),yes=await invite.put('Yes');
 const interest=await invite.put('Would you be interested in selling your property for all cash?','outgoing','ready');
 await q('insert into icash_sms_seller_openings values($1,$2,$3,$4,$5)',[account,invite.t,oq,yes,interest]);
 await q("insert into icash_sms_inbound_invitations(account_id,thread_id,reply_id,message_id,sender,recipient,deal_id,expires_at,called_number) values($1,$2,$3,$4,$5,$6,$7,now()+interval '1 hour','fixture-inbound')",[account,invite.t,yes,interest,invite.sender,invite.recipient,deal]);
 await q("insert into icash_inbound_voice_routes values('fixture-inbound',$1,true,now()+interval '1 hour','fixture-config')",[invite.sender]);
 const allowed=await one('select icash_claim_text_before_buyer_package($1,$2,$3)',[account,interest,invite.sender]);assert.deepEqual(allowed,{fixtureAdmission:true});
 await invite.put(notice);assert.deepEqual(await one('select icash_claim_text_before_buyer_package($1,$2,$3)',[account,interest,invite.sender]),allowed,'Both actual claim delegates survive notice');
 await invite.put('No, stop contacting me.');assert.equal(await one('select icash_claim_text_before_buyer_package($1,$2,$3)',[account,interest,invite.sender]),null,'Real newer reply still invalidates old intent');
 // Original cadence exceptions survive the new hold: human dialogue, explicit
 // requested agreement in signed work, cancellation and manual reply.
 const cadenceSig='public.icash_seller_text_cadence_current(uuid,uuid,uuid,boolean)';
 await pg.exec(original.get(cadenceSig).replace('icash_seller_text_cadence_current(', 'fixture_old_cadence('));
 for(const kind of ['human','agreement','cancellation','manual']){
  const c=await fresh();if(kind==='human')await c.put('I want to sell.');
  const msg=await c.put('Fixture '+kind,'outgoing','ready');await c.put(notice);
  if(kind==='agreement')await q("update icash_deal_files set stage='under_contract' where id=$1",[deal]);
  if(kind==='cancellation')await q('insert into icash_cancellation_notices values($1,$2)',[account,msg]);
  if(kind==='manual')await q('update icash_text_messages set customer_author_id=$2 where id=$1',[msg,randomUUID()]);
  assert.equal(await one('select fixture_old_cadence($1,$2,$3,false)',[account,c.t,msg]),true,kind+' originally permitted at cadence gate');
  assert.equal(await one('select icash_seller_text_cadence_current($1,$2,$3,false)',[account,c.t,msg]),true,kind+' preserves original cadence exception');
  assert.equal(await one('select icash_text_automatic_notice_hold($1,$2)',[account,msg]),false,kind+' not frozen by carrier classification');
  await q("update icash_deal_files set stage='draft' where id=$1",[deal]);
 }
 console.log('Carrier retained delegates: real ordinary reply, handoff, limited prepare, two claim wrappers, old/new human/agreement/cancellation/manual cadence exceptions passed.');
}
