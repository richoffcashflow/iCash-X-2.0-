// Isolated PostgreSQL/WASM verification. No provider, credentials or remote DB.
// node scripts/test-attention-notifications-pglite.mjs /absolute/path/to/pglite/dist/index.js
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const path = process.argv[2];
if (!path || !isAbsolute(path)) throw Error('Supply an existing official PGlite module path');
const {PGlite} = await import(pathToFileURL(path).href);
const pg = await PGlite.create();
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const a = uuid(1), b = uuid(2), u = uuid(11), v = uuid(12), p = uuid(21), q = uuid(22), d = uuid(31), e = uuid(32);
const scalar = async (sql, params = []) => Object.values((await pg.query(sql, params)).rows[0])[0];
const prefs = () => scalar('select public.icash_attention_preferences($1,$2)', [a, u]);
const save = (enabled = true, categories = ['needs_you','signatures','callbacks','closing']) => scalar('select public.icash_save_attention_preferences($1,$2,$3,$4,$5)', [a,u,enabled,categories,enabled ? '2026-09-30-attention-email-1' : null]);
const claim = () => scalar('select public.icash_claim_attention_email($1)', [a]);
const authorize = id => scalar('select public.icash_authorize_attention_email($1,$2)', [a,id]);
async function clearClaims() { await pg.exec('delete from public.icash_attention_emails'); }
try {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table public.icash_accounts(id uuid primary key,owner_user_id uuid);
    create table public.icash_screening_jobs(id uuid primary key,account_id uuid,state text);
    create table public.icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb default '{}');
    create table public.icash_text_attention(id uuid primary key,account_id uuid,screening_id uuid,deal_id uuid,message_id uuid,kind text,state text,updated_at timestamptz default now());
    create table public.icash_handoffs(id uuid primary key,account_id uuid,screening_id uuid,state text,created_at timestamptz default now());
    create table public.icash_sms_call_requests(id uuid primary key,account_id uuid,screening_id uuid,deal_id uuid,message_id uuid,state text,requested_at timestamptz default now());
    create table public.icash_live_callbacks(id uuid primary key,account_id uuid,screening_id uuid,state text,due_at timestamptz default now());
    create table public.icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,state text,test_mode boolean,updated_at timestamptz default now());
    create table public.icash_title_tasks(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,due_date date,updated_at timestamptz default now());
    create table public.icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid,kind text constraint icash_automation_tickets_kind_check check(kind in ('discovery','new_deployed_kind')),token text default gen_random_uuid()::text||gen_random_uuid()::text,state text default 'issued',created_at timestamptz default now(),expires_at timestamptz default now()+interval '2 minutes');
    create function public.icash_next_automation() returns jsonb language sql as $$ select nullif(current_setting('fixture.prior',true),'')::jsonb $$;
    insert into auth.users values('${u}','owner@example.com',now()),('${v}','other@example.com',now());
    insert into public.icash_accounts values('${a}','${u}'),('${b}','${v}');
    insert into public.icash_screening_jobs values('${p}','${a}','complete'),('${q}','${b}','complete');
    insert into public.icash_deal_files(id,account_id,screening_id,stage) values('${d}','${a}','${p}','under_contract'),('${e}','${b}','${q}','under_contract');
    insert into public.icash_text_attention(id,account_id,screening_id,deal_id,message_id,kind,state) values('${uuid(41)}','${a}','${p}','${d}','${uuid(141)}','human','open');
    insert into public.icash_handoffs(id,account_id,screening_id,state) values('${uuid(42)}','${a}','${p}','open');
    insert into public.icash_sms_call_requests(id,account_id,screening_id,deal_id,message_id,state) values('${uuid(43)}','${a}','${p}','${d}','${uuid(143)}','needs_review');
    insert into public.icash_live_callbacks(id,account_id,screening_id,state) values('${uuid(44)}','${a}','${p}','held_for_human');
    insert into public.icash_signing_envelopes(id,account_id,deal_id,state,test_mode) values('${uuid(45)}','${a}','${d}','customer_signature_needed',false),('${uuid(145)}','${a}','${d}','customer_signature_needed',true);
    insert into public.icash_title_tasks(id,account_id,deal_id,kind,state,due_date) values('${uuid(46)}','${a}','${d}','deadline','needs_review',current_date),('${uuid(47)}','${a}','${d}','deadline','scheduled',current_date),('${uuid(147)}','${a}','${d}','deadline','scheduled',current_date+30);
  `);
  await pg.exec(read('config/attention-notifications.sql'));
  assert.equal((await prefs()).enabled, false); assert.equal((await prefs()).available, false); assert.equal(await claim(), null);
  await assert.rejects(save(), /unavailable/);
  await pg.exec('update public.icash_attention_email_settings set enabled=true');
  await assert.rejects(scalar('select public.icash_save_attention_preferences($1,$2,true,$3,$4)', [a,u,['needs_you'],'wrong']), /consent/);
  await assert.rejects(scalar('select public.icash_attention_preferences($1,$2)', [a,v]), /ownership/);
  await save(); assert.equal((await prefs()).enabled, true);
  assert.equal(await scalar('select count(*)::int from public.icash_attention_sources($1)', [a]), 7);
  assert.equal(await scalar('select count(*)::int from public.icash_attention_sources($1)', [b]), 0);
  // Corrupted cross-account bindings cannot become email links.
  await pg.exec(`insert into public.icash_handoffs(id,account_id,screening_id,state) values('${uuid(148)}','${a}','${q}','open')`);
  assert.equal(await scalar('select count(*)::int from public.icash_attention_sources($1)', [a]), 7);
  let id = await claim(); let job = await authorize(id);
  assert.equal(job.kind, 'closing_deadline'); assert.equal(job.recipient, 'owner@example.com'); assert.equal(job.pendingCount, 7); assert.equal(job.screeningId,p);
  assert.equal(await authorize(id), null, 'Pre-send authorization is one use'); assert.equal(await claim(), null, 'Hourly cap');
  await scalar('select public.icash_finish_attention_email($1,$2,$3)', [a,id,uuid(500)]);
  await pg.exec(`update public.icash_attention_emails set created_at=now()-interval '2 hours'`);
  id=await claim(); assert.equal((await authorize(id)).kind,'signature');
  await scalar('select public.icash_finish_attention_email($1,$2,null)',[a,id]);
  await pg.exec(`update public.icash_attention_emails set created_at=now()-interval '2 hours'`);
  id=await claim(); assert(id); await pg.exec(`update public.icash_attention_emails set created_at=now()-interval '2 hours'`);
  assert.equal(await claim(),null,'Three claims, including failure, consume daily cap');
  await clearClaims(); await save(true,['signatures']); id=await claim();
  await pg.exec(`update public.icash_signing_envelopes set state='completed' where id='${uuid(45)}'`);
  assert.equal(await authorize(id),null,'Resolved source cannot dispatch');
  await clearClaims(); await pg.exec(`update public.icash_signing_envelopes set state='customer_signature_needed' where id='${uuid(45)}'`); id=await claim();
  await save(false); assert.equal(await authorize(id),null,'Opt-out invalidates unsent claims'); assert.equal(await claim(),null);
  await clearClaims(); await save(); id=await claim();
  await pg.exec(`update auth.users set email='changed@example.com' where id='${u}'`);
  assert.equal(await authorize(id),null,'Recipient cannot change without new consent'); assert.equal(await claim(),null);
  await pg.exec(`update auth.users set email='owner@example.com',email_confirmed_at=null where id='${u}'`); assert.equal(await claim(),null,'Unverified identity fails closed');
  await pg.exec(`update auth.users set email_confirmed_at=now() where id='${u}'`);
  await clearClaims(); await save(); id=await claim();
  await pg.exec(`update public.icash_attention_emails set created_at=now()-interval '3 minutes'`); assert.equal(await authorize(id),null,'Stale claim expires');
  await clearClaims(); id=await claim(); job=await authorize(id);
  await scalar('select public.icash_attention_delivery_event($1,$2,$3,$4)',[id,uuid(501),'other@example.com','email.bounced']); assert.equal((await prefs()).enabled,true,'Wrong recipient event ignored');
  await scalar('select public.icash_attention_delivery_event($1,$2,$3,$4)',[id,uuid(501),'owner@example.com','email.bounced']);
  assert.equal((await prefs()).suppressed,true); assert.equal((await prefs()).enabled,false);
  await scalar('select public.icash_finish_attention_email($1,$2,$3)',[a,id,uuid(501)]);
  await scalar('select public.icash_attention_delivery_event($1,$2,$3,$4)',[id,uuid(501),'owner@example.com','email.delivered']);
  assert.equal(await scalar('select state from public.icash_attention_emails where id=$1',[id]),'bounced','Late receipt/delivery cannot undo bounce');
  await assert.rejects(save(),/review/);
  await pg.exec('update public.icash_attention_email_preferences set suppressed_at=null,suppression_reason=null'); await save();
  await scalar('select public.icash_unsubscribe_attention($1)',[job.unsubscribeToken]); assert.equal((await prefs()).enabled,false); await save();
  await clearClaims(); await pg.exec('update public.icash_attention_email_settings set global_daily_limit=1');
  id=await claim(); await pg.exec(`update public.icash_attention_emails set created_at=now()-interval '2 hours'`); assert.equal(await claim(),null,'Platform cap');
  await clearClaims(); await pg.exec(`update public.icash_deal_files set stage='closed' where id='${d}'`); assert.equal(await claim(),null,'Closed property never alerts');
  await pg.exec(`update public.icash_deal_files set stage='under_contract',terms='{"practice":true}' where id='${d}'`); assert.equal(await claim(),null,'Practice content never alerts');
  await pg.exec(`update public.icash_deal_files set terms='{}' where id='${d}'`);
  // Service-only access: table RLS enabled and all routines denied to browser roles.
  assert.equal(await scalar("select bool_and(relrowsecurity) from pg_class where relname in ('icash_attention_email_settings','icash_attention_email_preferences','icash_attention_emails')"),true);
  for (const role of ['anon','authenticated']) {
    assert.equal(await scalar(`select has_function_privilege('${role}','public.icash_claim_attention_email(uuid)','execute')`),false);
    assert.equal(await scalar(`select has_table_privilege('${role}','public.icash_attention_email_preferences','select')`),false);
  }
  await pg.exec(read('config/attention-notifications-scheduler.sql'));
  await pg.exec(`select set_config('fixture.prior','{"token":"original-priority"}',false)`);
  assert.deepEqual(await scalar('select public.icash_next_automation()'),{token:'original-priority'});
  assert.equal(await scalar('select count(*)::int from public.icash_automation_tickets'),0,'Original scheduler work keeps priority');
  await pg.exec(`select set_config('fixture.prior','',false)`);
  assert((await scalar('select public.icash_next_automation()')).token); assert.equal(await scalar('select public.icash_next_automation()'),null,'Global one-minute scan cap');
  await pg.exec(`update public.icash_attention_email_settings set next_scan_at=now()-interval '1 minute'`);
  assert.equal(await scalar('select public.icash_next_automation()'),null,'Account cadence/in-flight ticket cap');
  await pg.exec(`insert into public.icash_automation_tickets(account_id,kind) values('${a}','new_deployed_kind')`);
  console.log('PASS: all 7 sources, test/stale/cross-tenant exclusions, verified recipient/opt-in/category gates, source resolution, opt-out, caps/dedupe, provider races, service-only privileges, original-priority idle scheduler and preserved deployed kinds');
  console.log('LIMITATIONS: isolated single-connection fixture schema; no production schema/advisors, concurrent-connection race, provider delivery or deployed browser verification');
} catch (error) {
  console.error('ISOLATED_SQL_FAILED', error.message, error.detail ?? '', error.where ?? ''); process.exitCode=1;
} finally { await pg.close(); }
