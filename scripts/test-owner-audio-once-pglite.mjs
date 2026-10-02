import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// LOCAL SIMULATION ONLY. No network, provider, credentials, database URL,
// production installation, wallet operations, or seller actions.
// Usage: node scripts/test-owner-audio-once-pglite.mjs /path/to/@electric-sql/pglite/dist/index.js
// PGlite serializes queries. Promise.all below covers replay/interleaving
// semantics, NOT independent PostgreSQL sessions or real lock contention.
// Before activation, use a fresh disposable local PostgreSQL database and two
// independent sessions to verify each ordering of arm/arm, attempt/cancel,
// claim/claim, finish/finish, and expiry while waiting for a row lock. Session A
// leaves its RPC uncommitted; B must wait. A COMMIT gives exactly one winner;
// A ROLLBACK allows B to win without leftover state. Do not count a timeout as
// success. Never reset this singleton in an existing or production database.

if (!process.argv[2]) throw new Error('Pass the local @electric-sql/pglite/dist/index.js path');
const {PGlite} = await import(pathToFileURL(process.argv[2]).href);
const db = await PGlite.create();
const sql = readFileSync(new URL('../config/owner-audio-once.sql', import.meta.url), 'utf8');
const targetSource = readFileSync(new URL('../lib/owner-inbound-acceptance.ts', import.meta.url), 'utf8');
const account = '48dfb798-8c1a-404f-88c0-c396cc067062';
const user = '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
const other = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const configHash = 'a'.repeat(64), salt = 'b'.repeat(64), challengeHash = 'c'.repeat(64);
const version = 'agtvrsn_audioOnceFixture', branch = 'owner-audio-once-fixture';
const sid = 'CA' + 'd'.repeat(32), otherSid = 'CA' + 'e'.repeat(32);
const conversation = 'conv_audioOnceFixture', otherConversation = 'conv_otherFixture';
const armArgs = [account, user, configHash, version, branch, salt, challengeHash];
const q = (text, values = []) => db.query(text, values);
const rpc = async (name, values = []) => (await q(
 `select public.icash_${name}_owner_audio_once(${values.map((_, i) => `$${i + 1}`).join(',')}) as result`, values
)).rows[0].result;
const arm = (args = armArgs) => rpc('arm', args);
const attempt = (call = sid, conv = conversation) => rpc('attempt', [call, conv]);
const claim = (call = sid, conv = conversation, hash = configHash, v = version) => rpc('claim', [call, conv, hash, v]);
const finish = (result, call = sid, conv = conversation) => rpc('finish', [call, conv, JSON.stringify(result)]);
const cancel = (a = account, u = user) => rpc('cancel', [a, u]);
const result = (changes = {}) => ({status: 'passed', forwarding: 'unverified', durationSeconds: 21, challenge: 'passed', ...changes});
const row = async () => (await q('select to_jsonb(t) as result from public.icash_owner_audio_once t')).rows[0]?.result ?? null;
let assertions = 0, scenarios = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const ok = (actual, message) => { assert.ok(actual, message); assertions++; };
const denied = async (fn, pattern = /permission denied|must be owner/i) => {
 await q('savepoint denied_probe');
 try { await assert.rejects(fn, pattern); assertions++; }
 finally { await q('rollback to savepoint denied_probe'); await q('release savepoint denied_probe'); }
};
async function scenario(name, test) {
 await q('begin');
 try {
  await q('set local role service_role');
  await test();
  scenarios++;
  console.log(`PASS ${name}`);
 } finally { await q('rollback'); }
}
async function privileged(fn) {
 await q('reset role');
 try { return await fn(); } finally { await q('set local role service_role'); }
}
// Only the fixture administrator can insert backdated timestamps. Production
// application roles cannot INSERT or mutate time. No trigger is disabled, and
// the exact candidate SQL runs unmodified in all tests.
async function expiringFixture(seconds) {
 return privileged(async () => {
  await q(`insert into public.icash_owner_audio_once
   (id,account_id,owner_user_id,state,config_hash,version_id,branch_name,challenge_salt,challenge_hash,armed_at,expires_at)
   select 1,$1,$2,'armed',$3,$4,$5,$6,$7,t-interval '5 minutes',t
   from (select clock_timestamp()+$8::double precision*interval '1 second' as t) timing`, [...armArgs, seconds]);
 });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
 eq(targetSource.match(/accountId:'([^']+)'/)[1], account, 'SQL account is pinned to the existing approved owner');
 eq(targetSource.match(/ownerUserId:'([^']+)'/)[1], user, 'SQL user is pinned to the existing approved owner');
 // Reproduce permissive Supabase defaults so revocation is actually exercised.
 await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role untrusted_test_role nologin;
  grant usage on schema public to public;
  alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
 `);
 await db.exec(sql);

 await scenario('service role has SELECT and five RPCs only; public roles have no access', async () => {
  const metadata = (await q(`select p.proname,p.prosecdef,p.proconfig,
   has_function_privilege('service_role',p.oid,'EXECUTE') as service_exec,
   has_function_privilege('anon',p.oid,'EXECUTE') as anon_exec,
   has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_exec,
   has_function_privilege('untrusted_test_role',p.oid,'EXECUTE') as public_exec
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and (p.proname like 'icash_%_owner_audio_once' or p.proname='icash_owner_audio_once_guard')`)).rows;
  eq(metadata.length, 6);
  for (const fn of metadata) {
   const guard = fn.proname === 'icash_owner_audio_once_guard';
   eq(fn.prosecdef, !guard, `${fn.proname} privilege mode`);
   eq(fn.proconfig, ['search_path=""']);
   eq(fn.service_exec, !guard);
   eq([fn.anon_exec, fn.authenticated_exec, fn.public_exec], [false, false, false]);
  }
  const acl = (await q(`select relrowsecurity,
   has_table_privilege('service_role',oid,'SELECT') as select_ok,
   has_table_privilege('service_role',oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as write_ok,
   has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as anon_ok,
   has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as auth_ok,
   has_table_privilege('untrusted_test_role',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as public_ok
   from pg_class where oid='public.icash_owner_audio_once'::regclass`)).rows[0];
  eq(acl, {relrowsecurity: true, select_ok: true, write_ok: false, anon_ok: false, auth_ok: false, public_ok: false});
  eq(await row(), null);
  for (const role of ['anon', 'authenticated', 'untrusted_test_role']) {
   await q(`set local role ${role}`);
   await denied(() => q('select * from public.icash_owner_audio_once'));
   await denied(() => arm());
   await denied(() => attempt());
   await denied(() => claim());
   await denied(() => finish(result()));
   await denied(() => cancel());
  }
  await q('set local role service_role');
  await arm();
  for (const statement of [
   'update public.icash_owner_audio_once set state=\'armed\'',
   'delete from public.icash_owner_audio_once',
   'truncate public.icash_owner_audio_once',
   'insert into public.icash_owner_audio_once select * from public.icash_owner_audio_once',
   'alter table public.icash_owner_audio_once disable trigger all',
  ]) await denied(() => q(statement));
  await denied(() => q('select public.icash_owner_audio_once_guard()'));
 });

 await scenario('owner pins and strict arm inputs; first INSERT wins forever', async () => {
  for (const [index, bad] of [[0, other], [1, other], [0, null], [1, null], [2, 'x'], [2, null],
   [3, ''], [3, ' '.repeat(3)], [3, 'x'.repeat(161)], [4, 'short'], [4, 'x'.repeat(101)],
   [5, 'b'.repeat(63)], [5, null], [6, 'bad'], [6, null]]) {
   const args = [...armArgs]; args[index] = bad;
   eq(await arm(args), null);
  }
  eq(await row(), null);
  const arms = await Promise.all([arm(), arm(), arm()]);
  eq(arms.filter(Boolean).length, 1);
  const first = arms.find(Boolean);
  eq(first.id, 1); eq(first.state, 'armed'); eq(first.call_sid, null); eq(first.claimed_at, null);
  eq(first.account_id, account); eq(first.owner_user_id, user);
  eq(Date.parse(first.expires_at) - Date.parse(first.armed_at), 300_000);
  const changed = [...armArgs]; changed[2] = 'f'.repeat(64); changed[3] = 'changed-version';
  eq(await arm(changed), null);
  eq(await row(), first);
 });

 await scenario('one attempt binds exact identity; one matching claim; no replay', async () => {
  eq(await attempt(), null); eq(await claim(), null); eq(await cancel(), null); eq(await finish(result()), null);
  await arm();
  for (const [call, conv] of [[null, conversation], ['bad', conversation], [sid, null],
   [sid, 'conversation'], [sid, 'conv_' + 'x'.repeat(161)]]) eq(await attempt(call, conv), null);
  const attempts = await Promise.all([attempt(), attempt(otherSid, otherConversation), attempt()]);
  eq(attempts.filter(Boolean).length, 1);
  eq(attempts[0].state, 'inspecting'); eq(attempts[0].call_sid, sid); eq(attempts[0].conversation_id, conversation);
  eq(await finish(result()), null, 'inspecting cannot directly pass before admission');
  for (const args of [[otherSid, conversation, configHash, version], [sid, otherConversation, configHash, version],
   [sid.toUpperCase(), conversation, configHash, version], [sid, conversation, 'f'.repeat(64), version],
   [sid, conversation, configHash, 'other-version'], [null, conversation, configHash, version]]) eq(await claim(...args), null);
  const claims = await Promise.all([claim(), claim()]);
  eq(claims.filter(Boolean).length, 1); eq(claims[0].state, 'claimed');
  ok(Date.parse(claims[0].claimed_at) >= Date.parse(claims[0].armed_at));
  ok(Date.parse(claims[0].claimed_at) < Date.parse(claims[0].expires_at));
  eq(await cancel(), null); eq(await attempt(), null);
  eq(await finish(result(), otherSid), null); eq(await finish(result(), sid, otherConversation), null);
  const completed = await finish(result());
  eq(completed.state, 'passed'); eq(completed.result.forwarding, 'unverified', 'audio pass is explicit about missing forwarding proof');
  eq(await finish(result()), null); eq(await finish(result({status: 'failed'})), null);
  eq(await arm(), null); eq(await claim(), null); eq(await cancel(), null);
  eq(await row(), completed);
 });

 await scenario('attempt/cancel both interleaving orders are single-winner', async () => {
  await arm();
  eq(await cancel(other, user), null); eq(await cancel(account, other), null);
  const winner = await Promise.all([attempt(), cancel()]);
  eq(winner[0].state, 'inspecting'); eq(winner[1], null);
  eq(await cancel(), null); eq(await arm(), null);
 });
 await scenario('cancellation permanently consumes the one-use grant', async () => {
  await arm();
  const winner = await Promise.all([cancel(), attempt()]);
  eq(winner[0].state, 'cancelled'); eq(winner[1], null);
  eq(await cancel(), null); eq(await arm(), null); eq(await claim(), null); eq(await finish(result()), null);
 });

 await scenario('strict compact result rejects transcripts, unknown fields, and false success', async () => {
  await arm(); await attempt(); await claim();
  const malformed = [null, [], 'passed', {}, result({transcript: 'never store this'}), result({challengeCode: '12345678'}),
   result({status: 'armed'}), result({status: null}), result({forwarding: null}), result({forwarding: 'missing'}),
   result({forwarding: 'mismatch'}), result({challenge: false}), result({challenge: 'failed'}),
   result({challenge: 'unverified'}), result({durationSeconds: null}), result({durationSeconds: '21'}),
   result({durationSeconds: 0}), result({durationSeconds: -1}), result({durationSeconds: 61}),
   result({durationSeconds: 9007199254740992}), result({durationSeconds: {value: 21}})];
  const missing = result(); delete missing.forwarding; malformed.push(missing);
  for (const value of malformed) await denied(() => finish(value), /Invalid compact|Invalid owner audio|success evidence/);
  eq((await row()).state, 'claimed'); eq((await row()).result, null);
  eq((await finish(result({forwarding: 'verified', durationSeconds: 60}))).state, 'passed');
 });

 await scenario('needs_review can reconcile the same consumed call only', async () => {
  await arm(); await attempt(); await claim();
  const claimedAt = (await row()).claimed_at;
  eq((await finish(result({status: 'needs_review', challenge: 'unverified', durationSeconds: null}))).state, 'needs_review');
  eq((await row()).claimed_at, claimedAt);
  eq(await arm(), null); eq(await claim(), null); eq(await attempt(), null); eq(await cancel(), null);
  eq(await finish(result(), otherSid), null);
  eq((await finish(result({status: 'needs_review', challenge: 'unverified', durationSeconds: 18}))).state, 'needs_review');
  eq((await finish(result())).state, 'passed');
  eq((await row()).claimed_at, claimedAt);
  eq(await finish(result()), null);
 });
 await scenario('inspection failure cannot bypass admission through needs_review', async () => {
  await arm(); await attempt();
  eq((await finish(result({status: 'needs_review', challenge: 'unverified', durationSeconds: null}))).state, 'needs_review');
  eq((await row()).claimed_at, null);
  eq(await finish(result()), null);
  eq(await claim(), null); eq(await arm(), null);
  await privileged(async () => {
   await denied(() => q('update public.icash_owner_audio_once set claimed_at=clock_timestamp()'), /admission marker requires claim/);
   await denied(() => q("update public.icash_owner_audio_once set state='passed',result=$1", [JSON.stringify(result())]), /success evidence required/);
  });
  eq((await finish(result({status: 'failed', challenge: 'unverified', durationSeconds: null}))).state, 'failed');
 });
 await scenario('failed inspection and concurrent finalization remain consumed', async () => {
  await arm(); await attempt();
  const failed = result({status: 'failed', forwarding: 'mismatch', challenge: 'unverified', durationSeconds: null});
  const finishes = await Promise.all([finish(failed), finish(result({status: 'needs_review'}))]);
  eq(finishes.filter(Boolean).length, 1); eq(finishes[0].state, 'failed');
  eq(await finish(result()), null); eq(await claim(), null); eq(await arm(), null);
 });

 await scenario('expiry is wall clock even inside an old transaction; expiry never rearms', async () => {
  await expiringFixture(0.05);
  await sleep(100);
  eq(await attempt(), null); eq(await claim(), null); eq(await arm(), null);
  eq((await row()).state, 'armed');
  eq((await cancel()).state, 'cancelled'); eq(await arm(), null);
 });
 await scenario('claim expires after attempt; late failure can still be recorded', async () => {
  await expiringFixture(0.2); await attempt();
  await sleep(250);
  eq(await claim(), null);
  eq((await finish(result({status: 'failed', challenge: 'unverified', durationSeconds: null}))).state, 'failed');
  eq(await arm(), null);
 });
 await scenario('completion after admission expiry is allowed for the same claimed call', async () => {
  await expiringFixture(0.2); await attempt(); await claim();
  await sleep(250);
  eq((await finish(result())).state, 'passed'); eq(await arm(), null);
 });

 await scenario('immutable config, target, challenges, timestamps and provider identity', async () => {
  await arm();
  await privileged(async () => {
   for (const expression of ["id=2", `account_id='${other}'`, `owner_user_id='${other}'`,
    "config_hash=repeat('f',64)", "version_id='changed'", "branch_name='changed-branch'",
    "challenge_salt=repeat('f',64)", "challenge_hash=repeat('f',64)",
    "armed_at=armed_at-interval '1 second'", "expires_at=expires_at+interval '1 second'",
    "state='claimed'", "state='passed'"]) {
    await denied(() => q(`update public.icash_owner_audio_once set ${expression}`), /immutable|backward transition/);
   }
   await denied(() => q('delete from public.icash_owner_audio_once'), /cannot be removed/);
   await denied(() => q('truncate public.icash_owner_audio_once'), /cannot be removed/);
   await denied(() => q('update public.icash_owner_audio_once set claimed_at=clock_timestamp()'), /admission marker requires claim/);
  });
  await attempt();
  await privileged(async () => {
   for (const expression of [`call_sid='${otherSid}'`, `call_sid='${sid.toUpperCase()}'`,
    `conversation_id='${otherConversation}'`, 'call_sid=null', "state='armed'", "state='cancelled'"]) {
    await denied(() => q(`update public.icash_owner_audio_once set ${expression}`), /identity is immutable|backward transition/);
   }
  });
  await claim();
  await privileged(async () => {
   await denied(() => q('update public.icash_owner_audio_once set claimed_at=null'), /admission time is immutable/);
   await denied(() => q("update public.icash_owner_audio_once set claimed_at=claimed_at+interval '1 second'"), /admission time is immutable/);
  });
  await finish(result());
  await privileged(async () => {
   await denied(() => q("update public.icash_owner_audio_once set state='needs_review'"), /terminal record is immutable/);
   await denied(() => q('update public.icash_owner_audio_once set result=result'), /terminal record is immutable/);
   await denied(() => q('delete from public.icash_owner_audio_once'), /cannot be removed/);
  });
 });

 await scenario('temporary table shadowing cannot redirect SECURITY DEFINER writes', async () => {
  await privileged(async () => {
   await q('create temporary table icash_owner_audio_once (id integer, state text)');
   await q('grant all on table pg_temp.icash_owner_audio_once to service_role');
  });
  await q('set local search_path=pg_temp,public');
  eq((await arm()).state, 'armed');
  eq((await q('select count(*)::integer as count from pg_temp.icash_owner_audio_once')).rows[0].count, 0);
  eq((await row()).id, 1);
 });

 console.log(`Owner audio one-use SQL: ${scenarios} local scenarios, ${assertions} assertions passed`);
 console.log('PGlite interleavings passed; real multi-session PostgreSQL lock verification remains untested.');
} finally { await db.close(); }
