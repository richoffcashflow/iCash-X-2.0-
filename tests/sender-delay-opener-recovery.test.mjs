import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {setup, migration, delay, age} from './helpers/sender-delay-opener-fixture.mjs';

const pg=await PGlite.create();
const one=async(sql, params=[])=>Object.values((await pg.query(sql,params)).rows[0])[0];
const thread=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
const status=(sender='+17205550100')=>one('select icash_text_receipt_private.sender_opener_available($1)',[sender]);
const queue=n=>one('select icash_queue_seller_opener(account_id,id) from icash_text_threads where id=$1',[thread(n)]);
const candidate=n=>one('select icash_seller_opener_candidate_body(account_id,id) from icash_text_threads where id=$1',[thread(n)]);
try {
 await pg.exec(setup+migration);
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_text_receipt_private.sender_opener_available(text)','execute')",[role]),false);
 assert.equal(await status(),true);
 // The signed callback can arrive before the app saves the original send receipt.
 await pg.exec("update icash_text_messages set provider_id=null;"+delay);
 assert.equal(await status(),true);
 await pg.exec("update icash_text_messages set provider_id='text_fixture_delay';");
 assert.equal(await status(),false);
 assert.equal(await status('+17205550999'),true);
 await pg.exec("select fixture_seed_admission(2,2); select fixture_seed_admission(3,3);");
 assert.equal(await candidate(2),null);
 assert.equal(await queue(2),null);
 assert.equal(await one('select count(*) from icash_seller_opener_assignments'),1);
 const ledger=await one('select jsonb_agg(to_jsonb(o)) from icash_operation_spend o');
 for(const patch of [
  "update icash_text_events set payload=jsonb_set(payload,'{data,affected_id}','\"wrong\"')",
  "update icash_text_events set payload=jsonb_set(payload,'{data,original_number}','\"+17205550999\"')",
  "update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb(extract(epoch from now()-interval '2 hours')))",
  "update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb(extract(epoch from now()+interval '1 hour')))",
  "update icash_operation_spend set dispatched_at=null",
  "update icash_operation_spend set account_id=(select account_id from icash_text_threads where id='"+thread(2)+"')"
 ]){
  await pg.exec('begin;'+patch);
  assert.equal(await status(),true,patch);
  await pg.exec('rollback');
 }
 await pg.exec(age);
 assert.equal(await status(),true);
 assert(await candidate(2));assert(await queue(2));
 assert.equal(await queue(3),null,'One eligible normal introduction per recovering number');
 assert.equal(await status(),false);
 // A delayed confirmation for the older send is not proof that this line is back.
 await pg.exec("update icash_text_messages set state='delivered',last_delivery_at=now() where provider_id='text_fixture_delay';");
 assert.equal(await status(),false);
 const probe=await one('select message_id from icash_seller_opener_assignments where thread_id=$1',[thread(2)]);
 await pg.query("update icash_text_messages set provider_id='text_fixture_probe',state='accepted' where id=$1",[probe]);
 await pg.query("insert into icash_operation_spend select 'text:'||id,account_id,'settled',now() from icash_text_messages where id=$1",[probe]);
 assert.equal(await status(),false);
 await pg.query("update icash_text_messages set state='delivered',last_delivery_at=now() where id=$1",[probe]);
 assert.equal(await status(),true);assert(await candidate(3));
 assert.deepEqual(await one("select jsonb_agg(to_jsonb(o)) from icash_operation_spend o where operation_key <> 'text:'||$1::uuid",[probe]),ledger);
 assert.equal(await one("select count(*) from icash_text_messages where direction='incoming'"),0);
 console.log('PASS sender delay: source binding, sender isolation, ordering, normal retry cadence and terminal recovery');
} finally {await pg.close();}
