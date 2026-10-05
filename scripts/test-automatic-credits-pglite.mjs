// Isolated PostgreSQL simulation using schema/function metadata only. No providers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const q=(sql,args=[])=>pg.query(sql,args),value=async(sql,args=[])=>(await q(sql,args)).rows[0].value;
try{
 const schema=JSON.parse(file('tests/fixtures/automatic-credits-baseline.json'));
 const hybrid=JSON.parse(file('tests/fixtures/hybrid-baseline.json'));
 await pg.exec('create role anon;create role authenticated;create role service_role;create schema icash_recording_private;create function icash_recording_private.clock_now() returns timestamptz language sql as $$select now()$$;create schema auth;create table auth.users(id uuid primary key);set check_function_bodies=off;');
 for(const t of schema.tables){try{await pg.exec(t.definition.replace(/default icash_[a-z_]+\.clock_now\(\)/g,'default now()'));}catch(e){throw Error(t.name+': '+e.message);}}
 await pg.exec(Object.values(hybrid.functions).join(';\n')+';');
 await pg.exec(file('tests/fixtures/hybrid-free-scheduler.sql'));
 await pg.exec(file('supabase/migrations/20261005183118_hybrid_inbound_priority_acquisition.sql'));
 await pg.exec(schema.functions.map(f=>f.definition).join(';\n')+';');
 // Unchanged transport/eligibility adapters are isolated from this policy test.
 // The actual outer claim function below still decides whether manual control
 // permits a human message or blocks an automated one before reaching transport.
 await pg.exec(`create function icash_set_work_control(uuid,uuid,text,uuid) returns void language sql as $$select public.icash_set_work_control_before_sms_intake($1,$2,$3,$4)$$;
 create function icash_manual_handoff_reply(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select true$$;
 create function icash_outreach_sms_current(uuid) returns boolean language sql as $$select true$$;
 create function icash_claim_text_before_campaign(uuid,uuid,text) returns jsonb language sql as $$select '{"transportReached":true}'::jsonb$$;
 set check_function_bodies=on;`);
 await q('insert into icash_membership_offer(id,price_cents,enabled,revision) values(1,5000,true,1)');
 const pending=uuid();await q("insert into icash_daily_plans(id,state,mode) values($1,'pending','live')",[pending]);
 await pg.exec(file('supabase/migrations/20261005200735_automatic_credits_and_manual_conversations.sql'));
 assert.equal(await value('select price_cents value from icash_membership_offer where id=1'),5000);
 assert.equal(await value('select state value from icash_daily_plans where id=$1',[pending]),'stop_requested');
 for(const [balance,cap] of [[0,0],[500,500],[1000,1000],[10000,2000],[50000,10000],[1000000,100000]])assert.equal(await value('select icash_credit_work_pace($1) value',[balance]),cap);
 const a=uuid(),owner=uuid(),other=uuid(),membership=uuid(),order=uuid();
 await q('insert into auth.users values($1),($2)',[owner,other]);
 await q("insert into icash_accounts(id,owner_user_id,billing_model,bot_paused,daily_limit_cents) values($1,$2,'membership_credits',true,1000)",[a,owner]);
 await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,10000,200)',[a]);
 await q("insert into icash_memberships(id,account_id,mode,state,paid_through) values($1,$2,'live','active',now()+interval '30 days')",[membership,a]);
 await q("insert into icash_credit_ledger(account_id,kind,delta_cents) values($1,'usage',-500)",[a]);
 await q("insert into icash_funding_orders(id,account_id,mode,state,price_cents,credit_cents,credited_at) values($1,$2,'live','paid',10000,10000,now())",[order,a]);
 const apply=()=>value('select icash_apply_prepaid_purchase($1) value',[order]);
 assert.equal(await apply(),false,'funding without accepted terms never starts');
 await q("insert into icash_funding_consents(order_id,account_id,version,price_cents,credit_cents) values($1,$2,'work-credits-2026-10-05.1',10000,10000)",[order,a]);
 assert.equal(await apply(),true);assert.equal(await value('select bot_paused value from icash_accounts where id=$1',[a]),false);
 assert.equal(await value('select daily_limit_cents value from icash_accounts where id=$1',[a]),2660,'capacity includes reserved/settled work plus a bounded new allowance');
 const allowed=()=>value('select icash_credit_acquisition_allowed($1) value',[a]);
 assert.equal(await allowed(),true,'paid software and credits can acquire leads');
 await q("update icash_memberships set state='payment_failed' where id=$1",[membership]);assert.equal(await allowed(),false,'missed subscription holds new acquisition');
 await q("update icash_memberships set state='active',paid_through=now()-interval '1 second' where id=$1",[membership]);assert.equal(await allowed(),false,'expired paid period holds work');
 await q("update icash_memberships set paid_through=now()+interval '30 days' where id=$1",[membership]);assert.equal(await allowed(),true,'recovered subscription restores eligibility');
 await q('update icash_wallets set balance_cents=reserved_cents where account_id=$1',[a]);assert.equal(await allowed(),false,'no available credits holds acquisition');
 await q('update icash_wallets set balance_cents=10000 where account_id=$1',[a]);
 await q('update icash_accounts set bot_paused=true where id=$1',[a]);await apply();assert.equal(await allowed(),false,'payment webhook replay cannot restart a later hold');
 await q('update icash_accounts set bot_paused=false where id=$1',[a]);
 const screen=uuid(),deal=uuid(),thread=uuid(),key=uuid();
 await q('insert into icash_operating_budget(id) values(1) on conflict do nothing');
 await q("insert into icash_screening_jobs(id,account_id,state,snapshot,result,completed_at) values($1,$2,'complete','{\"propertyId\":\"synthetic_1\"}','{\"financialCheck\":{\"status\":\"eligible\"}}',now())",[screen,a]);
 await q("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$3,'draft','{}')",[deal,a,screen]);
 await q("insert into icash_text_threads(id,account_id,deal_id,party,recipient,dnc_checked_at) values($1,$2,$3,'seller','+12025550101',now())",[thread,a,deal]);
 const send=(actor=owner,request=key,body='Hello')=>value("select icash_queue_customer_text($1,$2,$3,$4,$5,'{}') value",[actor,a,thread,request,body]);
 await assert.rejects(send(other));
 const queued=await send();const message=queued.id;assert.equal(queued.manual,true);const manual=()=>value("select manual value from icash_property_controls where account_id=$1 and property_id='synthetic_1'",[a]);
 assert.equal(await manual(),true);assert.equal(await value('select icash_customer_authored_text($1,$2) value',[a,message]),true);
 assert.equal((await value('select icash_claim_text_before_owner_question($1,$2,$3) value',[a,message,'+12025550102'])).transportReached,true,'explicit customer message may pass property takeover');
 await q("update icash_screening_jobs set completed_at=now()-interval '7 days' where id=$1",[screen]);
 assert.equal((await value('select icash_claim_text_before_owner_question($1,$2,$3) value',[a,message,'+12025550102'])).transportReached,true,'customer may continue an older conversation');
 const automated=await value("select icash_queue_text($1,$2,$3,'Automatic','{}') value",[a,thread,uuid()]);
 assert.equal(await value('select icash_claim_text_before_owner_question($1,$2,$3) value',[a,automated,'+12025550102']),null,'unmarked automated message is held during takeover');
 await q("select icash_set_work_control($1,$2,'return_to_bot',$3)",[owner,a,screen]);assert.equal(await manual(),false);
 assert.deepEqual(await send(),{id:message,manual:false});assert.equal(await manual(),false,'retry cannot undo a later Return to bot');
 await assert.rejects(send(owner,key,'Different'));assert.equal(await manual(),false,'conflicting retry changes neither message nor control');
 // Assigned seller email is available before signing, then disappears on opt-out.
 const lead=uuid();await q("insert into icash_seller_intakes(id,email,name,phone,email_consented,data_rights_until,created_at) values($1,'seller@example.test','Synthetic Seller','+12025550101',true,now()+interval '1 day',now())",[lead]);
 await q('insert into icash_seller_matches(lead_id,account_id,screening_id) values($1,$2,$3)',[lead,a,screen]);
 const contacts=()=>q('select * from icash_deal_email_contacts($1,$2)',[a,deal]);
 assert.equal((await contacts()).rows.some(r=>r.email==='seller@example.test'),true);
 assert.equal((await q('select * from icash_deal_email_contacts($1,$2)',[other,deal])).rows.length,0,'email never crosses accounts');
 await q("insert into icash_email_suppressions(account_id,email) values($1,'seller@example.test')",[a]);assert.equal((await contacts()).rows.length,0);
 for(const signature of ['icash_queue_customer_text(uuid,uuid,uuid,uuid,text,uuid[])','icash_credit_acquisition_allowed(uuid)','icash_deal_email_contacts(uuid,uuid)'])assert.equal(await value("select has_function_privilege('authenticated',$1,'execute') value",[signature]),false);
 console.log('PASS full credits migration: automatic paid activation, bounded pacing, empty/failed/expired holds, recovery, replay protection, customer takeover, automated-message hold, Return to bot, seller email scope/opt-out, private RPCs.');
}catch(e){console.error(e.message,e.where??'',e.internalQuery??'');process.exitCode=1;}finally{await pg.close();}
