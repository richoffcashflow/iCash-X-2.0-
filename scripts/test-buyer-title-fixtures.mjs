import assert from 'node:assert/strict';
// Runs inside the real local migration fixture; no external contacts.
export async function testBuyerTitle({q,one,rpc,a,d,sc,t,session,hash}){
 const buyer=message=>({role:'user',message}),agent=message=>({role:'agent',message});
 const turns=[agent('Have you closed an assignment deal with a wholesaler before?'),buyer('Yes, twice.'),agent('Which local title company did you use?'),buyer('Fixture Local Title.'),agent('Who is your escrow contact?'),buyer('Pat, pat@example.invalid.'),buyer('I want to view the property.')];
 const quote='Yes, twice.\nFixture Local Title.\nPat, pat@example.invalid.';
 assert.equal(await rpc('icash_buyer_title_quote',[turns]),quote);
 for(const text of ['What title company are you using?','I do not have a title company.','Can I use my own title company?'])assert.equal(await rpc('icash_buyer_title_quote',[[buyer(text)]]),null);
 assert.equal(await rpc('icash_buyer_title_quote',[turns.concat(buyer('I no longer want that title company.'))]),null);
 assert.equal(await rpc('icash_buyer_title_quote',[turns.concat(buyer('STOP'))]),null);
 assert.equal((await rpc('icash_buyer_package_data',[a,d])).titleSelectionStatus,'not_selected');
 assert.match(await rpc('icash_buyer_factual_text',[a,t,'Which title company are you using?']),/has not been selected yet/);
 await q('begin');
 await q("update icash_deal_files set terms=terms||'{\"titleEmail\":\"closer@example.invalid\"}' where id=$1",[d]);
 assert.equal((await rpc('icash_buyer_package_data',[a,d])).titleSelectionStatus,'needs_confirmation');
 await q("insert into icash_title_contacts values($1,$2,'closer@example.invalid',true,now()+interval '1 day')",[d,a]);
 const selected=await rpc('icash_buyer_package_data',[a,d]);assert.equal(selected.titleSelectionStatus,'selected');assert(!JSON.stringify(selected).includes('closer@example.invalid'));
 assert.match(await rpc('icash_buyer_factual_text',[a,t,'Can I use my title company?']),/already selected/);
 await q("update icash_title_contacts set verified_until=now()-interval '1 day' where deal_id=$1",[d]);
 assert.equal((await rpc('icash_buyer_package_data',[a,d])).titleSelectionStatus,'needs_confirmation');
 await q('rollback');
 await q('begin');
 await rpc('icash_recorded_reception_property_context',[session,'nonce']);
 await q("update icash_recorded_reception_private.sessions set state='available',conversation_id='conv_title',call_ended_at=now() where id=$1",[session]);
 assert.equal(await rpc('icash_save_buyer_inbound_history',[session,'conv_wrong',turns]),false);
 assert.equal(await rpc('icash_save_buyer_inbound_history',[session,'conv_title',turns]),true);
 let request=await one('select kind,quote,title_quote from icash_buyer_viewing_requests where source_id=$1',[session]);
 assert.equal(request.kind,'viewing');assert.match(request.quote,/view the property/);assert.equal(request.title_quote,quote);
 await q("update icash_buyer_viewing_requests set state='reviewed' where source_id=$1",[session]);
 assert.equal(await rpc('icash_save_buyer_inbound_history',[session,'conv_title',turns]),true);
 assert.equal((await one('select state from icash_buyer_viewing_requests where source_id=$1',[session])).state,'reviewed');
 assert.equal(await rpc('icash_save_buyer_inbound_history',[session,'conv_title',[buyer('I use Changed Title.')]]),false);
 assert.equal((await one('select count(*)::int n from icash_title_contacts')).n,0);
 assert.equal(await rpc('icash_buyer_is_reserved',[a,d]),false);
 await q('rollback');
 const message=(await one("insert into icash_text_messages(account_id,thread_id,direction,state,body) values($1,$2,'incoming','received','I have used Fixture Title Company for assignments.') returning id",[a,t])).id;
 request=await one('select kind,title_quote from icash_buyer_viewing_requests where source_id=$1',[message]);
 assert.equal(request.kind,'title_company');assert.equal(request.title_quote,'I have used Fixture Title Company for assignments.');
 assert.equal((await rpc('icash_buyer_package_data',[a,d])).titleSelectionStatus,'not_selected');
 for(const role of ['anon','authenticated']){
  assert.equal((await one('select has_function_privilege($1,\'public.icash_buyer_title_quote(jsonb)\',\'execute\') allowed',[role])).allowed,false);
 }
 console.log('PASS buyer title preferences: exact call/SMS evidence, unchanged viewing request, replay and identity gates, selected/unselected state, no automatic verification or reservation.');
}
