import assert from 'node:assert/strict';
export async function testBuyerPricePrivacy({q,one,rpc,a,d,t}){
 const p=await rpc('icash_buyer_package_data',[a,d]);
 assert.equal(p.askingPriceCents,16227050);assert.equal(p.depositCents,200000);assert.equal(p.privacyPolicy,'buyer_price_only_v1');
 for(const field of ['purchasePriceCents','assignmentFeeCents','depositPolicy'])assert(!Object.hasOwn(p,field),field);
 const ownerContent=await rpc('icash_owner_buyer_test_content',['88888888-8888-4888-8888-888888888888']);
 assert.equal(typeof ownerContent.email,'string');assert.match(ownerContent.email,/assignment fee is included/);assert.match(ownerContent.email,/\$162,270\.50/);assert(!/152,270|10,000/.test(ownerContent.email));
 const volunteered='Who is the title company? I have closed assignments before with Fixture Local Title, Pat, pat@example.invalid.';
 assert.equal(await rpc('icash_buyer_title_quote',[[{role:'user',message:volunteered}]]),volunteered);
 assert.equal(await rpc('icash_buyer_title_quote',[[{role:'agent',message:'Have you closed an assignment deal with a wholesaler before?'},{role:'user',message:'Yes, with First American.'}]]),'Yes, with First American.');
 assert.equal(await rpc('icash_buyer_title_quote',[[{role:'user',message:'Can I use my own title company?'}]]),null);
 for(const question of ['What is the assignment fee?','How much did you pay?','How much did you get it under contract for?','What is your spread?','Is the seller getting $152,270.50?','Is the $2,000 deposit twenty percent of your spread?']){
  const answer=await rpc('icash_buyer_factual_text',[a,t,question]);
  assert.match(answer,/Internal acquisition pricing and margins are private/);assert.match(answer,/\$162,270\.50/);
  assert(!/152,270|10,000|twenty|20%/.test(answer),answer);
 }
 assert.match(await rpc('icash_buyer_factual_text',[a,t,'What payment methods do you accept?']),/check, wire, Cash App or Zelle/);
 assert.match(await rpc('icash_buyer_factual_text',[a,t,'What is the deposit?']),/\$2,000\.00/);
 assert.equal(await rpc('icash_buyer_factual_text',[a,t,'STOP. What is your spread?']),null);
 await q('begin');
 for(const body of ['Underlying purchase price: $152,270.50','Assignment fee: $10,000.00','Includes the $10,000.00 assignment fee.'])for(const contact of ['buyer-request:fixture','owner-buyer-test:fixture']){
  const id=(await one("insert into icash_deal_emails(id,account_id,deal_id,contact_key,body_text) values(gen_random_uuid(),$1,$2,$4,$3) returning id",[a,d,body,contact])).id;
  assert.equal(await rpc('icash_claim_deal_email',[a,id]),null,'old private email must not dispatch');
 }
 const safe=(await one("insert into icash_deal_emails(id,account_id,deal_id,contact_key,body_text) values(gen_random_uuid(),$1,$2,'buyer-request:fixture','Buyer asking price: $162,270.50') returning id",[a,d])).id;
 assert.deepEqual(await rpc('icash_claim_deal_email',[a,safe]),{claimed:true});
 await q('rollback');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'public.icash_buyer_package_data(uuid,uuid)','execute') allowed",[role])).allowed,false);
 console.log('PASS buyer price privacy: buyer-only RPC projection, private-price SMS boundary, deposit and payment facts retained, old queued breakdown emails blocked, unchanged role privileges.');
}
