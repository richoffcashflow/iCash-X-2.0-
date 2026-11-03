import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {currentAdmissionSql,captured} from './helpers/seller-opener-bounded-admission.mjs';
for(const bounded of [false,true]){
 const pg=new PGlite(),one=async(s,a=[])=>Object.values((await pg.query(s,a)).rows[0]??{})[0];
 try{
  await pg.exec(currentAdmissionSql(bounded));
  for(const f of captured.functions)assert.equal(await one('select md5(pg_get_functiondef($1::regprocedure))',[f.signature]),f.hash,'Captured function stays exact: '+f.signature);
  await pg.exec('select fixture_seed_admission(1,1);');
  const before=await one('select to_jsonb(w) from icash_wallets w');
  const result=await one('select icash_next_before_sms_inbound_campaign()');assert(result?.token);
  const message=await one('select to_jsonb(m) from icash_text_messages m');
  assert.equal(message.state,'ready');assert.equal(message.provider_id,null);assert.equal(message.customer_price_micros,20800);assert.equal(message.route_revision,1);
  assert.equal(await one('select message_id from icash_seller_opener_assignments'),message.id,'Actual observer binds the actual queued message');
  assert.equal(await one('select owner_question_id from icash_sms_seller_openings'),message.id);
  assert.equal(await one('select count(*)::integer from icash_operation_spend'),0,'Queued draft creates no financial operation');
  assert.deepEqual(await one('select to_jsonb(w) from icash_wallets w'),before);
  await pg.exec('update icash_accounts set bot_paused=true;');
  assert.equal(await one("select icash_claim_text_before_owner_question(account_id,id,'+17205550100') from icash_text_messages"),null,'Actual final-send account lock rejects saved Pause before any provider capability');
  assert.equal(await one('select state from icash_text_messages'),'ready');
  assert.equal(await one('select count(*)::integer from icash_operation_spend'),0);
 }finally{await pg.close();}
}
console.log('PASS original/bounded selector with exact current opener, text queue, assignment, routing/price/observation triggers and early final-send Pause guard; isolated source review, no paid dispatch or financial-success simulation.');
