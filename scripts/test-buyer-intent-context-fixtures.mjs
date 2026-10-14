import assert from 'node:assert/strict';

// Five buyer flows, replayed against the actual request writers and SQL rules.
// No provider traffic, messages, booking, signatures or payment are authorized.
export async function testBuyerIntentContext({q,one,rpc,a,d,t,session}){
 const user=message=>({role:'user',message}),agent=message=>({role:'agent',message});
 const viewing=turns=>rpc('icash_buyer_viewing_quote',[turns]);
 const intent=turns=>rpc('icash_buyer_purchase_intent',[turns]);
 const insert=async body=>(await one("insert into icash_text_messages(account_id,thread_id,direction,state,body) values($1,$2,'incoming','received',$3) returning id",[a,t,body])).id;
 await q('begin');
 try{
  // 1. No seller slots: retain the actual request, including an unavailable day.
  const reschedule="I can't do Friday. Can I view the property on Saturday?";
  assert.equal(await viewing([user(reschedule)]),reschedule);
  const shortRequest='I cannot do Friday. Can I view Saturday?';
  assert.equal(await viewing([user(shortRequest)]),shortRequest);
  assert.equal(await viewing([user('I cannot view Saturday.')]),null);
  assert.equal(await viewing([user('Do not send the contract yet. Can I view the property first?')]),'Do not send the contract yet. Can I view the property first?');
  const rescheduleId=await insert(reschedule);
  assert.equal((await one('select kind,quote from icash_buyer_viewing_requests where source_id=$1',[rescheduleId])).quote,reschedule);
  assert.match(await rpc('icash_buyer_factual_text',[a,t,'What times are available?']),/check with the seller.*available viewing times/);
  assert.equal(await viewing([user(reschedule),user("I don’t want to view the property.")]),null);
  assert.equal(await viewing([user(reschedule),user('STOP')]),null);

  // 2. Skipping a visit must preserve the explicit assignment request. A
  // corrected payment report is not verified money and cannot hide that request.
  const ready="I don't need to view it. Please send the assignment agreement.";
  assert.equal(await viewing([user(ready)]),null);
  assert.equal(await viewing([user('Do I have to view the property?')]),null);
  assert.equal((await intent([user(ready)])).kind,'reservation');
  const unpaid="I haven’t paid yet. Please send the assignment agreement.";
  assert.deepEqual(await intent([user('I sent the deposit.'),user(unpaid)]),{kind:'reservation',quote:unpaid});
  assert.equal(await intent([user('I sent the deposit.'),user("I didn't send anything.")]),null);
  const unpaidId=await insert(unpaid);
  assert.equal((await one('select kind,quote from icash_buyer_viewing_requests where source_id=$1',[unpaidId])).kind,'reservation');
  assert.equal(await rpc('icash_buyer_is_reserved',[a,d]),false);
  assert.equal((await one('select count(*)::int n from icash_buyer_deposit_receipts')).n,0);

  // 3. Existing price privacy and dollar-only deposit replies are unchanged.
  const publicPackage=await rpc('icash_buyer_package_data',[a,d]);
  assert(!Object.hasOwn(publicPackage,'purchasePriceCents'));
  assert(!Object.hasOwn(publicPackage,'assignmentFeeCents'));
  const privateReply=await rpc('icash_buyer_factual_text',[a,t,'How much is your assignment fee?']);
  assert.match(privateReply,/Internal acquisition pricing and margins are private/);
  assert(!privateReply.includes('$10,000'));
  assert.match(await rpc('icash_buyer_factual_text',[a,t,'What is the deposit?']),/\$2,000\.00/);

  // 4. A title-company answer after a showing question is only a title preference.
  const title='I use Fixture Title Company.';
  assert.equal(await viewing([agent('Would you like to view the property?'),user(title)]),null);
  assert.equal(await rpc('icash_buyer_title_quote',[[agent('Would you like to view the property?'),user(title)]]),title);
  await q("insert into icash_text_messages(account_id,thread_id,direction,state,provider_id,body,created_at) values($1,$2,'outgoing','delivered','intent-context-view-question','Would you like to view the property?',now()-interval '1 second')",[a,t]);
  const titleId=await insert(title);
  const titleRequest=await one('select kind,title_quote,viewing_quote from icash_buyer_viewing_requests where source_id=$1',[titleId]);
  assert.equal(titleRequest.kind,'title_company');assert.equal(titleRequest.title_quote,title);assert.equal(titleRequest.viewing_quote,null);
  assert.equal((await rpc('icash_buyer_package_data',[a,d])).titleSelectionStatus,'not_selected');
  await q("delete from icash_text_messages where provider_id='intent-context-view-question'");

  // 5. A human or agreement question must not become a viewing acceptance.
  for(const text of ['Please send the assignment agreement.','What is the deposit?','Yes, but I need a real person to call me.'])assert.equal(await viewing([agent('Would you like to view the property?'),user(text)]),null,text);
  assert.equal(await viewing([agent('Would you like to view the property?'),user('Yes.')]),'Yes.');
  assert.equal(await viewing([agent('What day and time works for a viewing?'),user('Saturday at 3 PM Central.')]),'Saturday at 3 PM Central.');
  const human='Please have a real person call me.';
  assert.equal(await rpc('icash_buyer_coordination_quote',[[user(human)]]),human);
  assert.equal(await rpc('icash_buyer_factual_text',[a,t,human]),null);
  await rpc('icash_recorded_reception_property_context',[session,'nonce']);
  await q("update icash_recorded_reception_private.sessions set state='available',conversation_id='conv_buyer_intent_context',call_ended_at=now() where id=$1",[session]);
  const turns=[agent('Would you like to view the property?'),user(title),user(reschedule),user(unpaid),user(human)];
  assert.equal(await rpc('icash_save_buyer_inbound_history',[session,'conv_buyer_intent_context',turns]),true);
  const request=await one('select * from icash_buyer_viewing_requests where source_id=$1',[session]);
  assert.equal(request.kind,'reservation');assert.equal(request.quote,unpaid);assert.equal(request.viewing_quote,reschedule);assert.equal(request.title_quote,title);assert.equal(request.coordination_quote,human);
  assert.equal(await rpc('icash_save_buyer_inbound_history',[session,'conv_buyer_intent_context',turns]),true);
  assert.equal((await one('select count(*)::int n from icash_buyer_viewing_requests where source_id=$1',[session])).n,1);
  for(const role of ['anon','authenticated'])for(const name of ['icash_buyer_viewing_quote','icash_buyer_purchase_intent'])assert.equal((await one('select has_function_privilege($1,$2,\'execute\') allowed',[role,`public.${name}(jsonb)`])).allowed,false);
 }finally{await q('rollback');}
 console.log('PASS 5 buyer flows: unavailable viewing day, optional viewing/unpaid agreement, private pricing, local title preference, human handoff; exact multi-request evidence, idempotency and no reservation from claims.');
}
