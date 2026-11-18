import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setup, migration as fairness, seedDelay, readyRetry} from './helpers/deferred-sender-fairness-fixture.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migration = read('config/expired-seller-sender-wait.sql');
const files = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .filter(name => name.endsWith('_expired_seller_sender_wait.sql'));
assert.equal(files.length, 1);
assert.equal(read('supabase/migrations/' + files[0]), migration);

const pg = await PGlite.create();
const val = async sql => Object.values((await pg.query(sql)).rows[0])[0];
const waiting = "md5('messagewaiting')::uuid";
const thread = "md5('threadwaiting')::uuid";
const owner = "md5('owner')::uuid";
const turn = () => val("select icash_sender_private.waiting_turn('+14155550100')");
const next = () => val('select public.icash_next_sender_volume_retry()');
const original = () => val(`select jsonb_build_array(
  (select to_jsonb(m) from public.icash_text_messages m where id=${waiting}),
  (select binding from icash_sender_private.waiting where message_id=${waiting}),
  (select jsonb_agg(to_jsonb(o) order by operation_key) from public.icash_operation_spend o),
  (select count(*) from icash_sender_private.uses))`);
async function scenario(run) {
  await pg.exec('begin');
  try { await run(); } finally { await pg.exec('rollback'); }
}

try {
  await pg.exec(setup + seedDelay + 'begin;' + fairness + 'commit;');
  await pg.exec(`update public.icash_text_threads set operational_contact_id=md5('expired')::uuid,
    eligibility_until=now()-interval '20 minutes' where id=${thread};`);
  const saved = await original();
  assert.equal(await turn(), true, 'expired contact previously blocked this number');
  await scenario(async () => assert.equal((await next()).claimKind, 'automatic'));

  await scenario(async () => {
    await pg.exec('grant execute on function public.icash_next_sender_volume_retry() to public');
    await assert.rejects(() => pg.exec(migration), /prerequisite changed/);
  });
  await pg.exec('begin;' + migration + 'commit;');
  assert.equal(await turn(), false, 'expired original yields to an eligible opener on the same number');
  await scenario(async () => {
    assert.equal(await next(), null);
    assert.equal(await val(`select count(*)::integer from icash_sender_private.waiting where message_id=${waiting}`), 1);
    assert.ok(await val(`select public.icash_queue_seller_opener(${owner},fixture_thread('current'))`));
    assert.deepEqual(await original(), saved, 'no change to the original message, sender admission or charge');
  });

  for (const [label, change] of [
    ['renewed contact', `update public.icash_text_threads set eligibility_until=now()+interval '1 hour' where id=${thread}`],
    ['manual send', "update icash_sender_private.waiting set claim_kind='manual'"],
    ['buyer', `update public.icash_text_threads set party='buyer' where id=${thread}`],
    ['separate permission', `update public.icash_text_threads set operational_contact_id=null where id=${thread}`],
    ['transactional delivery', `insert into public.icash_contract_text_deliveries(message_id,thread_id,account_id)
      select id,thread_id,account_id from public.icash_text_messages where id=${waiting}`],
  ]) await scenario(async () => {
    await pg.exec(change);
    assert.equal(await turn(), true, label);
    assert.equal((await next()).messageId, await val(`select ${waiting}`), label);
    assert.equal(await next(), null, 'five-minute bound prevents duplicate selection');
  });

  await scenario(async () => {
    await pg.exec(`update public.icash_text_threads set eligibility_until=null where id=${thread}`);
    assert.equal(await turn(), false);
    assert.equal(await next(), null);
    await pg.exec(`select fixture_message('other',fixture_thread('other'));
      select icash_sender_private.defer(${owner},md5('messageother')::uuid,'+14155550100','automatic');
      update icash_sender_private.waiting set queued_at=now()-interval '10 minutes';` + readyRetry);
    assert.equal(await turn(), true, 'another eligible message on the same sender retains priority');
    assert.equal((await next()).messageId, await val("select md5('messageother')::uuid"));
    assert.deepEqual(await original(), saved);
  });
  assert.deepEqual(await original(), saved);
  console.log('PASS expired seller permission yields sender priority, eligible waits resume, and original messages and spend are preserved');
} finally {
  await pg.close();
}
