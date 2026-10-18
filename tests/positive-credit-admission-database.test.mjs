// Actual production admission functions, synthetic records, no network/provider spend.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const require=createRequire(import.meta.url);
const f=await createOperationalContactFixture(require.resolve('@electric-sql/pglite'),{automaticChannels:true});
const {pg,q,rpc,one,account,other,screening,deal,prepare,project}=f;
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
try{
 await pg.exec(`
 create table icash_acquisition_policy(id integer primary key,mode text);
 insert into icash_acquisition_policy values(1,'outbound');
 insert into icash_market_shortlist(zip,city,state,priority,evidence_year,source_url) values('75201','SIMULATION Dallas','TX',99,2026,'https://fixture.invalid/market');
 create table icash_timezone_names(name text primary key);insert into icash_timezone_names select name from pg_timezone_names;
 -- Isolate the final recovery wrapper from earlier scheduling lanes.
 create or replace function icash_next_before_unstarted_sms_recovery() returns jsonb language sql as $$select null::jsonb$$;
 -- Contact/membership behavior has separate full admission fixtures. These
 -- controlled dependencies let this regression exercise only the credit gate.
 create function icash_manual_contact_reason(uuid,uuid,text,text,uuid) returns text language sql as $$select null::text$$;
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
 `);
 await pg.exec(read('tests/fixtures/positive-credit-functions.sql'));
 await prepare();await project();
 const thread=(await one('select id from icash_text_threads where account_id=$1',[account])).id;
 const message=await rpc('icash_queue_seller_opener',{p_account:account,p_thread:thread});assert(message);
 await q("insert into icash_automation_tickets(account_id,kind,opener_message_id,state,outcome,issue_attempts,created_at,expires_at) values($1,'seller_opener',$2,'held','message_held',1,now()-interval '2 minutes',now()-interval '1 minute')",[account,message]);
 const rate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) select 'property_search','SIMULATION low-balance',100,costs_micros,'SIMULATION data quote',verified_at,expires_at,true from icash_operation_rates where id=$1 returning id",[f.owners])).id;
 await q('update icash_discovery_configs set enabled=true,auto_enabled=true,rate_id=$2 where account_id=$1',[account,rate]);
 await q('update icash_wallets set balance_cents=1 where account_id=$1',[account]);
 const candidateDeal=(await one("insert into icash_deals(account_id,address,stage) values($1,'SIMULATION candidate address','seller') returning id",[account])).id;
 await q("update icash_private.engine_configs set enabled=true,settings='{\"minimum_gross_margin\":0.5}' where engine='deal'");
 await q("insert into icash_private.work_candidates(account_id,deal_id,action,due_at,estimated_charge_cents,estimated_provider_cost_usd,quality_score,evidence_ref,permission_verified_until,operation_key) values($1,$2,'seller_callback',now(),100,0.01,0.5,'SIMULATION permission',now()+interval '1 day','SIMULATION-next-work')",[account,candidateDeal]);
 assert.equal((await rpc('icash_next_work',{p_account:account})).length,0,'reproduces maximum-estimate work selection gate');
 assert.equal(await rpc('icash_outbound_search_due',{p_account:account}),false,'reproduces the obsolete full-estimate discovery gate');
 assert.equal(await rpc('icash_next_before_owner_question',{}),null,'reproduces the unstarted SMS recovery gate');
 assert.match(await rpc('icash_manual_text_reason',{p_account:account,p_thread:thread,p_exclude:null}),/Add credits/);
 await pg.exec(read('config/positive-credit-admission.sql'));
 assert.equal((await rpc('icash_next_work',{p_account:account})).length,1,'positive credit permits a scoped work recommendation');
 assert.equal(await rpc('icash_outbound_search_due',{p_account:account}),true,'positive credits allow the otherwise-eligible search');
 assert.equal(await rpc('icash_manual_text_reason',{p_account:account,p_thread:thread,p_exclude:null}),null,'manual SMS uses the same positive-credit admission');
 const recovered=await rpc('icash_next_before_owner_question',{});assert(recovered?.token,'previously unstarted SMS recovers with positive credits');
 assert.equal(await rpc('icash_next_before_owner_question',{}),null,'the new capability is not duplicated');
 assert.equal((await one('select state,provider_id from icash_text_messages where id=$1',[message])).state,'ready','scheduling does not impersonate a provider receipt');
 await q('update icash_wallets set balance_cents=0 where account_id=$1',[account]);
 assert.equal((await rpc('icash_next_work',{p_account:account})).length,0,'zero credits prevent work recommendations');
 assert.equal(await rpc('icash_outbound_search_due',{p_account:account}),false);
 assert.match(await rpc('icash_manual_text_reason',{p_account:account,p_thread:thread,p_exclude:null}),/Add credits/);
 await q('update icash_wallets set balance_cents=1 where account_id=$1',[account]);
 await q('update icash_accounts set bot_paused=true where id=$1',[account]);
 assert.equal(await rpc('icash_outbound_search_due',{p_account:account}),false,'Pause is still respected');
 await q('update icash_accounts set bot_paused=false where id=$1',[account]);
 await q("update icash_acquisition_policy set mode='inbound'");
 assert.equal(await rpc('icash_outbound_search_due',{p_account:account}),false,'the acquisition strategy is not changed');
 await q("update icash_acquisition_policy set mode='outbound'");
 await q('update icash_discovery_configs set data_rights_until=now()-interval \'1 minute\' where account_id=$1',[account]);
 assert.equal(await rpc('icash_outbound_search_due',{p_account:account}),false,'expired data rights still block research');
 assert.match(await rpc('icash_manual_text_reason',{p_account:other,p_thread:thread,p_exclude:null}),/unavailable/,'thread ownership stays enforced');
 assert.equal((await one('select balance_cents from icash_wallets where account_id=$1',[account])).balance_cents,1,'readiness and scheduling do not charge a wallet');
 console.log('PASS actual SQL: low-balance research, unstarted SMS recovery, manual SMS, zero-balance/Pause/strategy/rights/tenant guards; no messages sent or charges.');
}finally{await pg.close();}
