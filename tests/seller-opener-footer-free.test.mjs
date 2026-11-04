// Disposable local database only; no provider calls, texts or paid operations.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {smsLength} from '../lib/sms-length.ts';
import {setupSql,migration,seedSql,queueSql,expected,original} from './helpers/seller-opener-footer-free-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),one=async(s,a=[])=>Object.values((await pg.query(s,a)).rows[0]??{})[0];
const patch=migration.replace(/^begin;\n/m,'').replace(/^commit;\n/m,'');
const candidate='select icash_seller_opener_candidate_body(account_id,id) from icash_text_threads';
const message=()=>one('select to_jsonb(m) from icash_text_messages m');
const assignment=()=>one('select to_jsonb(a) from icash_seller_opener_assignments a');
const isolated=async f=>{await pg.exec('begin');try{await f();}finally{await pg.exec('rollback');}};
const ticket=(state,outcome='null',completed='null',expiry="now()-interval '1 minute'",kind="'seller_opener'")=>
 `insert into icash_automation_tickets(account_id,kind,opener_message_id,state,outcome,completed_at,expires_at)
 select account_id,${kind},id,'${state}',${outcome},${completed},${expiry} from icash_text_messages;`;
const definitions=()=>one("select jsonb_object_agg(p.proname,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'");
let scenarios=0;
try{
 await pg.exec(setupSql+seedSql);
 const beforeFunctions=await definitions(),wallet=await one('select to_jsonb(w) from icash_wallets w');
 const oldVariant=await one("select to_jsonb(v) from icash_seller_opener_variants v where key='identity-v3'");
 assert.equal(await one(candidate),original,'Current production copy reproduces the unwanted footer');
 await isolated(async()=>{
  await pg.exec(patch);
  const after=await definitions();
  for(const [name,definition] of Object.entries(beforeFunctions)){
   let wanted=definition;
   if(name==='icash_seller_identity_opener')wanted=wanted.replace(' Reply STOP to opt out.','');
   if(name==='icash_assign_seller_opener')wanted=wanted.replaceAll('identity-v3','identity-v4');
   assert.equal(after[name],wanted,'No unrelated source, contact, routing, claim or receipt change: '+name);
  }
  assert.equal(await one(candidate),expected);
  const id=await one(queueSql);assert(id);
  const m=await message(),a=await assignment();
  assert.equal(m.body,expected);assert.equal(a.body,expected);assert.equal(a.variant,'identity-v4');assert.equal(a.learning_context,'identity-v4');
  assert.equal(a.message_id,id);assert.equal(await one('select owner_question_id from icash_sms_seller_openings'),id);
  assert.equal(m.customer_price_micros,20800);assert.equal(m.route_revision,1);assert.equal(m.provider_id,null);assert.equal(m.state,'ready');
  assert.equal(await one(queueSql),null,'No duplicate introduction');
  assert.equal(await one('select count(*)::int from icash_operation_spend'),0);
  assert.deepEqual(await one('select to_jsonb(w) from icash_wallets w'),wallet);
  assert.deepEqual(await one("select to_jsonb(v) from icash_seller_opener_variants v where key='identity-v3'"),oldVariant);
  assert.deepEqual(smsLength(expected),{units:expected.length,limit:160,fits:true});
  for(const [principal,address] of [['A & B Homes','123 Main St #4/2'],['A-B Homes','123 1/2 Main St']]){
   assert.equal(await one('select icash_seller_identity_opener($1,$2)',[principal,address]),`Hi, contacting you for ${principal} about a cash offer. Do you own ${address}?`);
  }
  const fixed='Hi, contacting you for  about a cash offer. Do you own 123 Main St?';
  assert.equal((await one("select icash_seller_identity_opener($1,'123 Main St')",['A'.repeat(160-fixed.length)])).length,160);
  assert.equal(await one("select icash_seller_identity_opener($1,'123 Main St')",['A'.repeat(161-fixed.length)]),null);
  for(const invalid of ['','A—B','A🙂B'])assert.equal(await one("select icash_seller_identity_opener($1,'123 Main St')",[invalid]),null);
  await pg.exec('update icash_accounts set bot_paused=true;');
  assert.equal(await one("select icash_claim_text_before_owner_question(account_id,id,'+17205550100') from icash_text_messages"),null);
  assert.equal(await one('select count(*)::int from icash_operation_spend'),0);
  scenarios++;
 });
 // Existing ready copy changes only with its exact automatic assignment.
 await one(queueSql);
 for(const history of ['',ticket('issued'),ticket('held',"'prospecting_budget_held'",'now()')])await isolated(async()=>{
  await pg.exec(history);
  const m=await message(),a=await assignment(),tickets=await one('select coalesce(jsonb_agg(to_jsonb(t)),\'[]\') from icash_automation_tickets t');
  await pg.exec(patch);
  assert.deepEqual(await message(),{...m,body:expected,updated_at:(await message()).updated_at});
  assert.deepEqual(await assignment(),{...a,body:expected,variant:'identity-v4',learning_context:'identity-v4'});
  assert.deepEqual(await one('select coalesce(jsonb_agg(to_jsonb(t)),\'[]\') from icash_automation_tickets t'),tickets,'Capabilities/holds are not reset');
  assert.deepEqual(await one('select to_jsonb(w) from icash_wallets w'),wallet);scenarios++;
 });
 const unchanged=[
  ...['accepted','delivered','dispatching','needs_review','cancelled','received'].map(s=>[`state ${s}`,`update icash_text_messages set state='${s}';`]),
  ['inbound',"update icash_text_messages set direction='incoming';"],
  ['provider receipt',"update icash_text_messages set provider_id='original-provider-id';"],
  ['event receipt',"update icash_text_messages set event_id='original-event-id';"],
  ['delivery timestamp','update icash_text_messages set last_delivery_at=now();'],
  ['customer-authored','update icash_text_messages set customer_author_id=gen_random_uuid();'],
  ['request binding','update icash_text_messages set request_key=gen_random_uuid();'],
  ['attachment',"update icash_text_messages set attachments='[{\"url\":\"original\"}]';"],
  ['asset',"update icash_text_messages set asset_ids=array[gen_random_uuid()];"],
  ['changed assignment',"update icash_seller_opener_assignments set body='Different saved copy';"],
  ['changed message',"update icash_text_messages set body='Customer message. Reply STOP to opt out.';"],
  ['assignment account','update icash_seller_opener_assignments set account_id=gen_random_uuid();'],
  ['assignment thread','update icash_seller_opener_assignments set thread_id=gen_random_uuid();'],
  ['old variant',"update icash_seller_opener_assignments set variant='interest-v2',learning_context='interest-v2';"],
  ['delivered assignment','update icash_seller_opener_assignments set delivered_at=now();'],
  ['answered assignment','update icash_seller_opener_assignments set first_reply_at=now();'],
  ['opted-out assignment','update icash_seller_opener_assignments set opted_out=true;'],
  ['buyer thread',"update icash_text_threads set party='buyer';"],
  ['opening binding','update icash_sms_seller_openings set owner_question_id=gen_random_uuid();'],
  ...['reserved','dispatched','settled'].map(s=>[`operation ${s}`,`insert into icash_operation_spend select 'text:'||id,account_id,'${s}' from icash_text_messages;`]),
  ['conversation evidence',"insert into icash_live_conversations select 'text:'||id from icash_text_messages;"],
  ['AI job','insert into icash_text_ai_jobs select gen_random_uuid(),id from icash_text_messages;'],
  ['inbound invitation','insert into icash_sms_inbound_invitations select gen_random_uuid(),id,thread_id from icash_text_messages;'],
  ['active ticket',ticket('issued','null','null',"now()+interval '1 minute'")],
  ['consumed ticket',ticket('consumed')],
  ['complete ticket',ticket('complete',"'sent'",'now()')],
  ['uncertain hold',ticket('held',"'held_for_reconciliation'",'now()')],
  ['unfinished budget hold',ticket('held',"'prospecting_budget_held'")],
  ['wrong ticket kind',ticket('held',"'prospecting_budget_held'",'now()',"now()-interval '1 minute'","'seller_recovery'")],
  ['unknown ticket state',ticket('other')],
  ['wrong ticket account',ticket('held',"'prospecting_budget_held'",'now()')+'update icash_automation_tickets set account_id=gen_random_uuid();'],
 ];
 for(const [label,mutation] of unchanged)await isolated(async()=>{
  // Seed one historical incoming row without violating today's immutable-route
  // trigger; the production trigger is restored before exercising migration.
  if(label==='inbound')await pg.exec('alter table icash_text_messages disable trigger user;');
  await pg.exec(mutation);
  if(label==='inbound')await pg.exec('alter table icash_text_messages enable trigger user;');
  const m=await message(),a=await assignment();
  await pg.exec(patch);assert.deepEqual(await message(),m,label+' message immutable');assert.deepEqual(await assignment(),a,label+' assignment immutable');
  if(label==='state accepted'||label==='uncertain hold')assert.deepEqual(await one('select icash_assign_seller_opener(account_id,thread_id) from icash_seller_opener_assignments'),{variant:a.variant,body:a.body,context:a.learning_context},'Existing assignment keeps its original version/copy');
  scenarios++;
 });
 for(const role of ['public','anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_queue_seller_opener(uuid,uuid)','execute')",[role]),false);
 assert.equal(migration,read('supabase/migrations/20261104034309_seller_opener_footer_free_copy.sql'));
 console.log(`PASS ${scenarios} footer-free seller-copy scenarios: exact queue/assignment proof, v4 isolation, safe unsent refresh, original receipts/holds/controls preserved; no paid sends.`);
}catch(error){console.error(error.stack);if(error.query)console.error(error.query);process.exitCode=1;}finally{await pg.close();}
