// Local synthetic database only. Real migration and settlement functions;
// provider, wallet and contact boundaries are isolated fixtures.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=await PGlite.create();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table public.icash_accounts(id uuid primary key,owner_user_id uuid);
 create table public.icash_screening_jobs(id uuid primary key);
 create table public.icash_operating_budget(id int,enabled boolean,standard_cost_multiplier int,elevenlabs_cost_multiplier int);
 create table public.icash_operation_rates(id uuid primary key default gen_random_uuid(),operation text,version text,charge_cents bigint,costs_micros jsonb,buffer_bps int,evidence_ref text,verified_at timestamptz,expires_at timestamptz,enabled boolean,voice_max_duration_seconds int);
 create table public.icash_operation_spend(operation_key text primary key,account_id uuid,state text,charge_cap_cents bigint);
 create table public.icash_voice_configs(account_id uuid,seller_rate_id uuid,enabled boolean);
 create table public.icash_deal_files(id uuid,account_id uuid,screening_id uuid);
 create table public.icash_text_threads(account_id uuid,deal_id uuid,recipient text,sender text,retired_at timestamptz);
 create table public.icash_text_senders(phone text,enabled boolean);
 create table public.settlements(operation text,charge bigint,components jsonb);
 create function public.icash_manual_contact_reason(uuid,uuid,text,text) returns text language sql as $$select null::text$$;
 create function public.icash_start_manual_call(uuid,uuid,uuid,text) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function public.icash_reserve_operation(a uuid,k text,r uuid,t timestamptz) returns void language sql as $$insert into public.icash_operation_spend select k,a,'dispatched',charge_cents from public.icash_operation_rates where id=r$$;
 create function public.icash_claim_operation(text) returns boolean language sql as $$select true$$;
 create function public.icash_settle_complete_costs(k text,c bigint,p jsonb,e text) returns void language sql as $$insert into public.settlements values(k,c,p)$$;`);
 for(const name of ['20261007013855_customer_business_phone_calls.sql','20261008173746_customer_phone_recordings.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 const account='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',screen='33333333-3333-4333-8333-333333333333',rate='44444444-4444-4444-8444-444444444444',call='55555555-5555-4555-8555-555555555555',ac='AC'+'a'.repeat(32),parent='CA'+'b'.repeat(32),recording='RE'+'c'.repeat(32);
 await db.query('insert into public.icash_accounts values($1,$2);',[account,actor]);await db.query('insert into public.icash_screening_jobs values($1)',[screen]);
 await db.exec(`insert into public.icash_operating_budget values(1,true,3,3);insert into public.icash_text_senders values('+12025550101',true);`);
 await db.query("insert into public.icash_operation_rates(id,operation,version,charge_cents,costs_micros,verified_at,expires_at,enabled) values($1,'seller_call','fixture',1000,'{\"twilio\":0,\"other\":0,\"vercel\":0}',now(),now()+interval '1 day',true)",[rate]);
 await db.query('insert into public.icash_voice_configs values($1,$2,true)',[account,rate]);await db.query('insert into public.icash_deal_files values($1,$2,$1)',[screen,account]);await db.query("insert into public.icash_text_threads values($1,$2,'+12025550103','+12025550101',null)",[account,screen]);
 const quote={recordingPolicy:'customer-phone-recorded-v1',currency:'USD',country:'US',from:'+12025550101',callback:'+12025550102',recipient:'+12025550103',checkedAt:new Date().toISOString(),receiptHash:'f'.repeat(64),callbackMicrosPerMinute:14000,recipientMicrosPerMinute:14000};
 const {rows:[{result}]}=await db.query('select public.icash_begin_customer_phone_call($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result',[actor,account,screen,quote.recipient,quote.callback,call,quote.from,ac,'a'.repeat(64),quote]);
 assert.equal(result.call.recording_required,true);assert.equal(result.call.recording_state,'pending');assert.equal(result.holdCents,113);
 const settle=async()=> (await db.query('select public.icash_settle_customer_phone_call($1) as ok',[call])).rows[0].ok;
 const carrier={currency:'USD',costMicros:14000,receiptHash:'b'.repeat(64)};
 await db.query("update public.icash_customer_phone_calls set parent_sid=$2,ended_at=now(),connected_at=now(),parent_receipt=$3,child_receipt=$3 where id=$1",[call,parent,carrier]);
 assert.equal(await settle(),false,'no fabricated recording costs before canonical metadata');
 const receipt={sid:recording,callSid:parent,providerAccountSid:ac,status:'completed',currency:'USD',costMicros:6000,policy:'customer-phone-recorded-v1',receiptHash:'c'.repeat(64),recordingPriceEstimated:true,storagePriceEstimated:true};
 await db.query("update public.icash_customer_phone_calls set recording_sid=$2,recording_state='available',recording_receipt=$3 where id=$1",[call,recording,{...receipt,callSid:'CA'+'d'.repeat(32)}]);assert.equal(await settle(),false,'another call cannot fund this recording');
 await db.query('update public.icash_customer_phone_calls set recording_receipt=$2 where id=$1',[call,receipt]);assert.equal(await settle(),true);assert.equal(await settle(),true);
 const {rows}=await db.query('select * from public.settlements');assert.equal(rows.length,1,'replayed callbacks settle once');assert.equal(rows[0].charge,11);assert.equal(rows[0].components.other.amountMicros,6000);assert.equal(rows[0].components.twilio.amountMicros,28000);
 for(const role of ['anon','authenticated']){const {rows:[r]}=await db.query("select has_table_privilege($1,'public.icash_customer_phone_calls','SELECT,INSERT,UPDATE,DELETE') as allowed",[role]);assert.equal(r.allowed,false);}
 console.log('PASS recorded manual-call migration: bounded hold includes capture/storage, absent or wrong-call receipts cannot settle, exact cost settles once, browser roles cannot read audio records.');
}finally{await db.close();}
