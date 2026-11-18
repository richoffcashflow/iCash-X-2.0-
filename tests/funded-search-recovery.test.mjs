import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import * as original from './helpers/independent-search-continuation-fixture.mjs';
import {rate as baseRate} from './helpers/targeting-query-binding-fixture.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migration = read('config/funded-search-recovery.sql');
const migrationName = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .find(name => name.endsWith('_funded_search_recovery.sql'));
assert.ok(migrationName);
assert.equal(read('supabase/migrations/' + migrationName), migration);
const rankingMigration = read('config/independent-search-market-order.sql');
const rankingName = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .find(name => name.endsWith('_independent_search_market_order.sql'));
assert.ok(rankingName);
assert.equal(read('supabase/migrations/' + rankingName), rankingMigration);

const pg = new PGlite();
const value = async (query, params = []) => Object.values((await pg.query(query, params)).rows[0])[0];
const account = original.account;
const op = original.operation;
const batchRate = '00000000-0000-4000-8000-000000000289';
const nextBatch = '00000000-0000-4000-8000-000000000290';
const rateSource = JSON.parse(read('tests/fixtures/targeting-before.json'))
  .find(f => f.proname === 'icash_prepare_research_efficiency').definition;
const recover = () => value(original.claimSql);
const prepare = () => value('select public.icash_prepare_research_efficiency($1)', [account]);
const config = () => value('select to_jsonb(c) from public.icash_discovery_configs c where account_id=$1', [account]);
const storedBase = () => value('select base_rate from icash_research_private.account_rates where account_id=$1', [account]);
const snapshot = () => value(`select jsonb_build_array(
  (select jsonb_agg(to_jsonb(o) order by operation_key) from public.icash_operation_spend o),
  (select jsonb_agg(to_jsonb(r) order by id) from icash_research_private.requests r),
  (select jsonb_agg(to_jsonb(w) order by account_id) from public.icash_wallets w))`);
async function scenario(run) {
  await pg.exec('begin');
  try { await run(); } finally { await pg.exec('rollback'); }
}
async function receipt(result) {
  await pg.query('update icash_research_private.requests set result=$2::jsonb where operation_key=$1',
    [op, JSON.stringify(result)]);
}
async function quoteSetup() {
  // This scenario has no live purchases, but retains the historical disjoint account.
  await pg.query('delete from public.icash_operation_spend where operation_key=$1', [op]);
  await pg.query('delete from icash_research_private.query_claims where operation_key=$1', [op]);
  await pg.query('delete from public.icash_discovery_filter_pages where operation_key=$1', [op]);
  await pg.query('update public.icash_discovery_configs set rate_id=$2, next_page=7, max_open_prospects=25 where account_id=$1',
    [account, batchRate]);
  await pg.query('insert into icash_research_private.account_rates values($1,$2)', [account, batchRate]);
  await pg.query('update public.icash_wallets set balance_cents=75 where account_id=$1', [account]);
}
try {
  await pg.exec('create role anon; create role authenticated; create role service_role;');
  await pg.exec(original.setupSql);
  await pg.exec(original.seedSql);
  await pg.exec('begin;' + original.migration + 'commit;');
  await pg.exec(original.activateSql);
  await pg.exec(`
    alter table public.icash_operation_rates add column version text, add column evidence_ref text,
      add column costs_micros jsonb, add column verified_at timestamptz,
      add column buffer_bps int, add column voice_max_duration_seconds int, add column flat_customer_price_cents int;
    create table icash_research_private.account_rates(account_id uuid primary key, base_rate uuid);
    create table icash_research_private.rate_versions(base_rate uuid, unit_micros bigint, batch_rate uuid,
      primary key(base_rate,unit_micros));
    create table icash_research_private.dealmachine_credit_state(id int primary key,enabled boolean,blocked boolean,
      available bigint,generation integer,latest_usage_generation integer,latest_usage_at timestamptz,
      latest_refusal_at timestamptz,cycle_end timestamptz);
    create table icash_research_private.dealmachine_credit_checks(generation integer,received_at timestamptz,result text);
    insert into icash_research_private.dealmachine_credit_state values
      (1,true,false,100,2,2,now()-interval '1 hour',now()-interval '2 hours',now()+interval '1 day');
    insert into icash_research_private.dealmachine_credit_checks
      select generation,latest_usage_at,'provider_credit_available' from icash_research_private.dealmachine_credit_state;
    update public.icash_operation_spend set created_at=dispatched_at-interval '1 second';
  `);
  await pg.exec(rateSource);
  await pg.exec('revoke all on function public.icash_prepare_research_efficiency(uuid) from public,anon,authenticated; grant execute on function public.icash_prepare_research_efficiency(uuid) to service_role;');
  await pg.query(`update public.icash_operation_rates set version='base',evidence_ref='fixture',charge_cents=51,
    costs_micros='{"dealmachine":100000,"other":40000}',buffer_bps=2000,verified_at=now()-interval '1 day' where id=$1`, [baseRate]);
  for (const [id, parent] of [[batchRate, baseRate], [nextBatch, batchRate]]) {
    await pg.query(`insert into public.icash_operation_rates
      (id,operation,enabled,expires_at,charge_cents,version,evidence_ref,costs_micros,verified_at,buffer_bps)
      select $1::uuid,operation,true,expires_at,105,'research25-'||($1::uuid)::text,'research-efficiency-v1:base:'||id,
        '{"dealmachine":250000,"other":40000}',verified_at,buffer_bps from public.icash_operation_rates where id=$2`, [id,parent]);
    await pg.query('insert into icash_research_private.rate_versions values($1,10000,$2)', [parent,id]);
  }
  await pg.exec('begin;' + migration + 'commit;');

  const denied = {outcome:'http_error',httpStatus:402};
  async function chooseMarket() {
    let chosen;
    await scenario(async () => {
      await receipt(denied);
      await pg.exec(`
        create or replace function public.icash_research_zip_known(text) returns boolean
        language sql stable as $$select $1 between '20101' and '20200'$$;
        insert into public.icash_inventory_markets(account_id,zip,next_scan_at,priority)
          select '${account}',n::text,now(),n from generate_series(20001,20200) n;
        insert into public.fixture_scores values('20164',100),('20165',1000);
      `);
      assert.equal(await recover(),true);
      chosen=(await config()).zip;
    });
    return chosen;
  }
  const originalChoice=await chooseMarket();
  assert.equal(originalChoice,'20164','The better-scoring 65th eligible ZIP is outside the candidate limit');
  await pg.exec('begin;' + rankingMigration + 'commit;');
  assert.equal(await chooseMarket(),originalChoice,'Ranking must scan beyond 100 unavailable ZIPs and preserve the candidate limit');
  await scenario(async () => {
    await receipt(denied);
    const before = await snapshot();
    assert.equal(await recover(), true);
    assert.notEqual((await config()).zip, '75217');
    assert.equal(await recover(), false, 'A repeat must leave the next original alone');
    assert.deepEqual(await snapshot(), before);
  });
  for (const change of [
    'update icash_research_private.dealmachine_credit_state set blocked=true',
    'update icash_research_private.dealmachine_credit_state set available=0',
    'update icash_research_private.dealmachine_credit_state set latest_usage_generation=1',
    "update icash_research_private.dealmachine_credit_state set cycle_end=now()-interval '1 second'",
    "update icash_research_private.dealmachine_credit_state set latest_usage_at=now()-interval '3 days'",
    'delete from icash_research_private.dealmachine_credit_checks',
    'update public.icash_accounts set bot_paused=true',
    'update public.icash_wallets set balance_cents=0',
    "update public.icash_bot_setups set profile='{\"marketMode\":\"city\",\"market\":\"75217\"}'",
    "insert into public.icash_operation_spend(operation_key,account_id,state) values('discovery:unscoped','" + original.other + "','dispatched')",
  ]) {
    await scenario(async () => {
      await receipt(denied);
      await pg.exec(change);
      assert.equal(await recover(), false, change);
    });
  }
  for (const [result, expected] of [
    [{...denied,creditsUsed:1}, false], [{outcome:'http_error',httpStatus:403},false],
    [{outcome:'response',httpStatus:200,returned:3,creditsUsed:3},true],
    [{outcome:'response',httpStatus:200,returned:6,creditsUsed:6},false],
    [{outcome:'response',httpStatus:200,returned:3,creditsUsed:2},false],
    [{outcome:'response',httpStatus:200,returned:'3',creditsUsed:'3'},false],
    [{outcome:'unknown'},true],
  ]) {
    await scenario(async () => {
      await receipt(result);
      const before = await snapshot();
      assert.equal(await recover(),expected,JSON.stringify(result));
      assert.deepEqual(await snapshot(),before);
    });
  }
  await scenario(async () => {
    await quoteSetup();
    const before = await config();
    const money = await snapshot();
    assert.equal(await prepare(),true);
    const after = await config();
    assert.equal(after.rate_id,baseRate);
    assert.equal(after.per_page,5);
    assert.equal(after.next_page,before.next_page);
    assert.equal(after.revision,before.revision);
    assert.equal(after.zip,before.zip);
    assert.equal(await storedBase(),baseRate);
    assert.equal(await prepare(),true);
    assert.deepEqual(await config(),after);
    assert.deepEqual(await snapshot(),money);
  });
  await scenario(async () => {
    await quoteSetup();
    await pg.query('update public.icash_wallets set balance_cents=1000 where account_id=$1',[account]);
    await pg.query('update public.icash_discovery_configs set per_page=25,rate_id=$2 where account_id=$1',[account,nextBatch]);
    const before = await config();
    assert.equal(await prepare(),true);
    const after = await config();
    assert.equal(after.rate_id,batchRate);
    assert.equal(after.per_page,25);
    assert.equal(after.revision,before.revision);
    assert.equal(after.next_page,before.next_page);
  });
  for (const change of [
    "insert into public.icash_automation_tickets(account_id,kind,state,expires_at) values('"+account+"','discovery','issued',now()+interval '2 minutes')",
    "insert into icash_research_private.query_claims select 'discovery:'||account_id||':'||revision||':'||next_page,account_id,'{}'::jsonb from public.icash_discovery_configs where account_id='"+account+"'",
    "update public.icash_accounts set bot_paused=true",
  ]) {
    await scenario(async () => {
      await quoteSetup();
      await pg.exec(change);
      const before = await config();
      assert.equal(await prepare(),false,change);
      assert.deepEqual(await config(),before);
      assert.equal(await storedBase(),batchRate);
    });
  }
  await scenario(async () => {
    await quoteSetup();
    await pg.query('update public.icash_operation_rates set charge_cents=104 where id=$1',[batchRate]);
    await prepare();
    assert.equal(await storedBase(),batchRate,'A changed price cannot authorize reparenting');
  });
  console.log('Funded search recovery passed receipt, budget, original-operation, cursor and rate-lineage checks.');
} finally {
  await pg.close();
}
