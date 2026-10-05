// SIMULATION ONLY: real response SQL over isolated synthetic dependencies. No network.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createOperationalContactFixture} from '../tests/helpers/operational-contact-fixture.mjs';
const f=await createOperationalContactFixture(process.argv[2]);
const {pg,q,rpc,one,account,other,phone,screening,deal,prepare,project}=f;
try{
 await pg.exec(`
 create table icash_seller_intakes(id uuid primary key,phone text,property jsonb,ai_consented boolean,created_at timestamptz default now(),name text default 'SIMULATION Seller',state text default 'assigned');
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid,assigned_at timestamptz default now(),primary key(lead_id,account_id));
 create table icash_seller_controls(id integer,enabled boolean,data_rights_until timestamptz,lookup_allowance_micros bigint,lookup_used_micros bigint,lookup_reserved_micros bigint);
 create table icash_seller_markets(enabled boolean,reviewed_until timestamptz);
 create table icash_daily_plans(account_id uuid,mode text,state text);
 create function icash_customer_update_sources(uuid) returns table(source_key text,kind text,screening_id uuid,event_at timestamptz,priority integer) language sql as $$select null::text,null::text,null::uuid,null::timestamptz,null::integer where false$$;
 `);
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261005124045_seller_response_handoff_and_activity.sql',import.meta.url),'utf8'));
 const lead=randomUUID();
 await q('insert into icash_seller_intakes(id,phone,property,ai_consented) values($1,$2,$3,true)',[lead,phone,{address:'123 Main Street',state:'TX'}]);
 await q('insert into icash_seller_matches(lead_id,account_id,screening_id) values($1,$2,$3)',[lead,account,screening]);
 assert.equal((await rpc('icash_seller_call_request',{p_account:account,p_screening:screening,p_phone:phone})).name,'SIMULATION Seller');
 assert.equal(await rpc('icash_seller_call_request',{p_account:other,p_screening:screening,p_phone:phone}),null);
 assert.equal(await rpc('icash_seller_call_request',{p_account:account,p_screening:screening,p_phone:'+12145550999'}),null);
 assert.equal((await one('select count(*)::int n from icash_seller_responses')).n,1,'assignment creates durable handoff');
 const terms=(await one('select terms from icash_deal_files where id=$1',[deal])).terms;
 let result=await rpc('icash_prepare_seller_responses',{p_lead:lead});assert.equal(result.length,1);assert.equal(result[0].smsMessageId,null);assert.equal(result[0].voiceJobId,null);
 assert.equal((await one('select state from icash_seller_responses')).state,'needs_setup');
 assert.equal((await one('select count(*)::int n from icash_contact_permissions')).n,0,'form consent cannot manufacture contact reviews');
 assert.deepEqual((await one('select terms from icash_deal_files where id=$1',[deal])).terms,terms,'never replaces saved negotiated terms');
 assert.equal((await rpc('icash_customer_update_sources',{p_account:account})).filter(x=>x.kind==='response_held').length,1);
 assert.equal((await rpc('icash_customer_update_sources',{p_account:other})).length,0,'tenant isolation');
 assert.deepEqual(await rpc('icash_prepare_seller_responses',{p_lead:lead}),[],'retry is bounded');
 await q('update icash_seller_responses set next_attempt_at=now()');
 await q('update icash_accounts set bot_paused=true where id=$1',[account]);
 assert.deepEqual(await rpc('icash_prepare_seller_responses',{p_lead:lead}),[],'Stop keeps dispatch empty');
 await q('update icash_accounts set bot_paused=false where id=$1',[account]);
 // Existing separately admitted operational SMS path, with real final claim tests elsewhere.
 await prepare();await project();
 await q('update icash_seller_responses set next_attempt_at=now()');
 result=await rpc('icash_prepare_seller_responses',{p_lead:lead});assert(result[0].smsMessageId,'queues an existing eligible SMS thread');assert.equal(result[0].voiceJobId,null);
 const message=result[0].smsMessageId;
 await q('update icash_text_messages set state=\'accepted\',provider_id=\'SIMULATION receipt\' where id=$1',[message]);
 await rpc('icash_note_seller_response',{p_lead:lead,p_account:account,p_outcome:{sms:'message_accepted',voice:'recorded_call_release_required'}});
 await q('update icash_seller_responses set next_attempt_at=now()');
 await rpc('icash_prepare_seller_responses',{p_lead:lead});
 assert.equal((await one('select state from icash_seller_responses')).state,'needs_setup','one channel cannot pretend both succeeded');
 assert.equal((await one('select count(*)::int n from icash_text_messages where direction=\'outgoing\'')).n,1,'no duplicate text after receipt');
 await q('insert into icash_text_suppressions(phone,reason) values($1,\'SIMULATION STOP\')',[phone]);
 await q('update icash_seller_responses set next_attempt_at=now()');
 assert.deepEqual(await rpc('icash_prepare_seller_responses',{p_lead:lead}),[]);
 assert.equal((await one('select state from icash_seller_responses')).state,'stopped');
 assert.equal((await rpc('icash_customer_update_sources',{p_account:account})).filter(x=>x.kind==='response_held').length,0,'resolved hold drops out');
 await assert.rejects(rpc('icash_note_seller_response',{p_lead:lead,p_account:account,p_outcome:{permission:true}}),/Invalid response outcome/);
 console.log('PASS response SQL: durable assignment handoff, no fabricated permission, prior terms preserved, bounded retries, Stop, single-channel failure visibility, no duplicate text, suppression and tenant-isolated alerts. SIMULATED ONLY.');
}finally{await pg.close();}
