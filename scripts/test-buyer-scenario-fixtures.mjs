import assert from 'node:assert/strict';
export async function testBuyerScenarios({q,one,rpc,a,d,t,session}){
 const user=message=>({role:'user',message}),agent=message=>({role:'agent',message});
 const agreements=['I want the assignment agreement.','Please text me the contract.','Please email me the agreement.','Can you send the assignment?','I am ready to sign.','I would like the payment instructions.'];
 for(const text of agreements)assert.equal((await rpc('icash_buyer_purchase_intent',[[user(text)]])).kind,'reservation',text);
 for(const text of ["I don't want the contract.",'Do not send the agreement.','I am not ready to sign.','I have not sent any money.','What is an assignment?','What payment methods are available?'])assert.equal(await rpc('icash_buyer_purchase_intent',[[user(text)]]),null,text);
 for(const text of ['I sent $500 through Cash App.','I already paid the deposit.','We have just wired the funds.'])assert.equal((await rpc('icash_buyer_purchase_intent',[[user(text)]])).kind,'payment_reported',text);
 assert.equal((await rpc('icash_buyer_purchase_intent',[[user('I sent $500 through Cash App.'),user('Please send the contract.')]])).kind,'payment_reported');
 assert.equal(await rpc('icash_buyer_purchase_intent',[[user('I sent the deposit.'),user('I did not send anything.')]]),null);
 for(const text of ['Please send me all the property pictures.','I can offer $150,000 and close on November 20.','I need a human to call me.','What if I need a refund?','Can I finance this property?'])assert.equal(await rpc('icash_buyer_coordination_quote',[[user(text)]]),text,text);
 assert.equal(await rpc('icash_buyer_coordination_quote',[[agent('Please send me all the property pictures.')]]),null);
 const volunteered='Yes, I used Fixture Title, Pat at pat@example.invalid.';
 assert.equal(await rpc('icash_buyer_title_quote',[[agent('Have you closed an assignment deal with a wholesaler before?'),user(volunteered)]]),volunteered);
 for(const text of ['I do not remember the name.','What is the deposit?','How much is the price','I want to view the property.','I am not sure.'])assert.equal(await rpc('icash_buyer_title_quote',[[agent('Which local title company did you use?'),user(text)]]),null,text);
 await q('begin');
 // Topic changes cannot be mistaken for company names or escrow contacts.
 for(const previous of ['Which local title company did you use?','The team can confirm whether that company handles assignments and this property. Who is your escrow contact there?',"What is the escrow contact's phone number or email?"]){
  await q("insert into icash_text_messages(account_id,thread_id,direction,state,provider_id,body,created_at) values($1,$2,'outgoing','delivered','title-fixture',$3,now()+interval '1 second')",[a,t,previous]);
  assert.match(await rpc('icash_buyer_factual_text',[a,t,'What is the deposit?']),/\$2,000\.00/);
  assert(!/escrow contact/.test(await rpc('icash_buyer_factual_text',[a,t,'What times are available?'])));
  await q("delete from icash_text_messages where provider_id='title-fixture'");
 }
 await q("insert into icash_text_messages(account_id,thread_id,direction,state,provider_id,body,created_at) values($1,$2,'outgoing','delivered','title-fixture','Which local title company did you use?',now()+interval '1 second')",[a,t]);
 assert.match(await rpc('icash_buyer_factual_text',[a,t,'I do not remember.']),/provide those details later/);
 await q('rollback');
 await q('begin');
 // One completed call can contain viewing, payment, title and photo requests.
 await rpc('icash_recorded_reception_property_context',[session,'nonce']);
 await q("update icash_recorded_reception_private.sessions set state='available',conversation_id='conv_scenarios',call_ended_at=now() where id=$1",[session]);
 const turns=[user('I want to view the property.'),user('Please text me the contract.'),agent('Have you closed an assignment deal with a wholesaler before?'),user(volunteered),user('Please send me all the property pictures.')];
 assert.equal(await rpc('icash_save_buyer_inbound_history',[session,'conv_scenarios',turns]),true);
 const request=await one('select * from icash_buyer_viewing_requests where source_id=$1',[session]);
 assert.equal(request.kind,'reservation');assert.equal(request.quote,'Please text me the contract.');assert.match(request.viewing_quote,/view the property/);assert.equal(request.title_quote,volunteered);assert.match(request.coordination_quote,/property pictures/);
 assert.equal((await one('select count(*)::int n from icash_buyer_deposit_receipts')).n,0);assert.equal(await rpc('icash_buyer_is_reserved',[a,d]),false);
 assert.equal(await rpc('icash_save_buyer_inbound_history',[session,'conv_wrong',turns]),false);
 assert.equal(await rpc('icash_save_buyer_inbound_history',[session,'conv_scenarios',[user('Changed evidence')]]),false);
 await q("update icash_buyer_viewing_requests set state='reviewed' where id=$1",[request.id]);
 await rpc('icash_save_buyer_inbound_history',[session,'conv_scenarios',turns]);
 assert.equal((await one('select state from icash_buyer_viewing_requests where id=$1',[request.id])).state,'reviewed');
 await q('rollback');
 await q('begin');
 const message=(await one("insert into icash_text_messages(account_id,direction,state,body) values($1,'incoming','received','I use Fixture Title Company.') returning id",[a])).id;
 assert.equal((await one('select count(*)::int n from icash_buyer_viewing_requests where source_id=$1',[message])).n,0);
 await q('update icash_text_messages set thread_id=$1 where id=$2',[t,message]);
 assert.match((await one('select title_quote from icash_buyer_viewing_requests where source_id=$1',[message])).title_quote,/Fixture Title/);
 const photo=(await one("insert into icash_text_messages(account_id,thread_id,direction,state,body) values($1,$2,'incoming','received','Please send all the property pictures.') returning id",[a,t])).id;
 assert.equal((await one('select kind from icash_buyer_viewing_requests where source_id=$1',[photo])).kind,'buyer_followup');
 await q('update icash_text_messages set thread_id=thread_id where id=$1',[photo]);
 assert.equal((await one('select count(*)::int n from icash_buyer_viewing_requests where source_id=$1',[photo])).n,1);
 const late=(await one("insert into icash_text_messages(account_id,thread_id,direction,state,body) values($1,$2,'incoming','queued','Please text me the contract.') returning id",[a,t])).id;
 assert.equal((await one('select count(*)::int n from icash_buyer_viewing_requests where source_id=$1',[late])).n,0);
 await q("update icash_text_messages set state='received' where id=$1",[late]);
 assert.equal((await one('select kind from icash_buyer_viewing_requests where source_id=$1',[late])).kind,'reservation');
 await q('rollback');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'public.icash_buyer_coordination_quote(jsonb)','execute') allowed",[role])).allowed,false);
 console.log('PASS buyer scenario data audit: agreement synonyms, payment reports, multi-request preservation, title topic switches, inline company evidence, photo/counteroffer/refund/human follow-up, late SMS routing and immutable replay.');
}
