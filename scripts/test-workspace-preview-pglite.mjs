import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,billing_model text,assistant_name text);
 create table icash_memberships(account_id uuid,mode text,state text,paid_through timestamptz,vip_until timestamptz,price_cents bigint);
 create table icash_wallets(account_id uuid,balance_cents bigint);
 create table icash_bot_setups(account_id uuid,profile jsonb,revision integer,updated_at timestamptz);
 create function icash_owner_overview(p_actor uuid,p_days integer,p_include_owner boolean,p_query text,p_page integer) returns jsonb language plpgsql as $$begin if p_actor<>'${id(1)}'::uuid then raise exception 'Owner required';end if;return '{}';end$$;
 create function icash_vip_active(p_account uuid) returns boolean language sql as $$select exists(select 1 from public.icash_memberships where account_id=p_account and state='active' and paid_through>now() and vip_until>now())$$;
 `);
 await pg.exec(read('config/vip-custom-voice.sql'));
 // Dependency fixtures for unrelated matching jobs. Real voice and access SQL runs below.
 for(const [name,args] of [['icash_network_deal_current','p_account uuid,p_deal uuid'],['icash_network_demand','p_account uuid'],['icash_network_save_buyer','p_account uuid,p_profile jsonb'],['icash_network_save_settings','p_account uuid,p_user uuid,p_enabled boolean,p_address text'],['icash_network_workspace','p_account uuid,p_deal uuid']])await pg.exec(`create function public.${name}(${args}) returns boolean language sql as $$select public.icash_vip_active(p_account)$$`);
 await pg.exec(`create function icash_queue_fulfillment() returns boolean language sql as $$select public.icash_vip_active(null)$$`);
 await pg.exec(read('supabase/migrations/20261012034706_functional_vip_preview.sql'));
 for(const n of [1,2]){
  await q("insert into icash_accounts values($1,$2,'membership_credits','Original')",[id(10+n),id(n)]);
  await q("insert into icash_memberships values($1,'live','active',now()+interval '1 day',null,5000)",[id(10+n)]);
  await q('insert into icash_wallets values($1,12345)',[id(10+n)]);
  await q(`insert into icash_bot_setups values($1,'{"displayName":"Original","voice":"sarah"}',1,now())`,[id(10+n)]);
 }
 const access=async n=>(await one('select icash_workspace_vip_access($1) v',[id(n)])).v;
 const preview=(user,account,mode)=>q('select icash_set_workspace_preview($1,$2,$3)',[id(account),id(user),mode]);
 const fingerprint=async()=>JSON.stringify((await q('select to_jsonb(m) m,to_jsonb(w) w from icash_memberships m join icash_wallets w using(account_id) order by account_id')).rows);
 const before=await fingerprint();
 assert.deepEqual(await access(11),{vip:false,vipFeatures:false,workspacePreview:null});
 await assert.rejects(preview(2,12,'vip'));
 await assert.rejects(preview(1,12,'vip'),'Admin cannot preview another account');
 await preview(1,11,'vip');assert.deepEqual(await access(11),{vip:false,vipFeatures:true,workspacePreview:'vip'});assert.equal((await access(12)).vipFeatures,false);
 await assert.rejects(q('select icash_begin_custom_voice($1,$2,$3,$4)',[id(2),id(11),'a'.repeat(64),'own-voice-2026-10-07.1']));
 await q('select icash_begin_custom_voice($1,$2,$3,$4)',[id(1),id(11),'a'.repeat(64),'own-voice-2026-10-07.1']);
 await q("update icash_custom_voices set state='ready',voice_id='fixture_voice' where account_id=$1",[id(11)]);
 assert.equal((await one('select icash_vip_call_voice($1) v',[id(11)])).v,'fixture_voice');
 await preview(1,11,'standard');assert.equal((await access(11)).vipFeatures,false);assert.equal((await one('select icash_vip_call_voice($1) v',[id(11)])).v,null);
 await assert.rejects(q('select icash_set_custom_voice_enabled($1,$2,true)',[id(1),id(11)]));
 await preview(1,11,'vip');await q("update icash_workspace_previews set expires_at=now()-interval '1 second'");assert.equal((await access(11)).vipFeatures,false);
 await preview(1,11,'vip');await q("update icash_memberships set state='payment_failed' where account_id=$1",[id(11)]);assert.equal((await access(11)).vipFeatures,false);await assert.rejects(preview(1,11,'vip'));await preview(1,11,null);
 await q("update icash_memberships set state='active' where account_id=$1",[id(11)]);
 await q('select icash_save_vip_bot_name($1,$2,$3)',[id(2),id(12),'Harper']);
 assert.equal((await one('select assistant_name from icash_accounts where id=$1',[id(12)])).assistant_name,'Harper');
 assert.equal((await one('select profile from icash_bot_setups where account_id=$1',[id(12)])).profile.displayName,'Harper');
 await assert.rejects(q('select icash_save_vip_bot_name($1,$2,$3)',[id(1),id(12),'Other']));
 await assert.rejects(q('select icash_save_vip_bot_name($1,$2,$3)',[id(2),id(12),'<script>']));
 assert.equal(await fingerprint(),before,'No preview/name action changes billing, discounts or credits');
 for(const role of ['anon','authenticated']){
  assert.equal((await one("select has_table_privilege($1,'icash_workspace_previews','SELECT') v",[role])).v,false);
  assert.equal((await one("select has_function_privilege($1,'icash_set_workspace_preview(uuid,uuid,text)','EXECUTE') v",[role])).v,false);
 }
 assert.equal((await one("select relrowsecurity v from pg_class where relname='icash_workspace_previews'")).v,true);
 console.log('PASS preview SQL: admin/account boundary, expiry, membership lock, real voice gates, Standard names and unchanged pricing/credits.');

 // Apply the next migration: the owner's request supersedes temporary previews.
 await pg.exec(read('supabase/migrations/20261012040641_admin_plan_toggle.sql'));
 const plan=(user,account,value)=>q('select icash_set_admin_plan($1,$2,$3)',[id(account),id(user),value]);
 const adminBefore=await fingerprint();
 await assert.rejects(plan(2,12,'vip'));await assert.rejects(plan(1,12,'vip'));await assert.rejects(plan(1,11,null));await assert.rejects(plan(1,11,'gold'));
 await q("update icash_accounts set billing_model='prepaid' where id=$1",[id(11)]);
 await plan(1,11,'vip');
 assert.deepEqual(await access(11),{vip:true,vipFeatures:true,adminPlan:'vip',workspacePreview:null});
 assert.equal((await access(12)).vip,false);
 assert.equal((await one('select icash_vip_call_voice($1) v',[id(11)])).v,'fixture_voice');
 await q("update icash_admin_plans set updated_at=now()-interval '5 days'");
 assert.equal((await access(11)).vip,true,'Real plan does not expire after four hours');
 await preview(1,11,null);assert.equal((await access(11)).vip,true,'Old sign-out cleanup cannot undo the real plan');
 await assert.rejects(preview(1,11,'standard'),'An old preview control cannot change actual entitlements');
 // Use the production question-pricing function with inert local credit fixtures.
 await pg.exec(`create table icash_operating_budget(id integer);insert into icash_operating_budget values(1);
 create table icash_workspace_questions(id uuid,account_id uuid,state text);
 create table icash_question_usage(question_id uuid,account_id uuid,model text,multiplier numeric);
 create function icash_reserve_credit(uuid,text,bigint) returns boolean language sql as $$select true$$;`);
 const pricing=read('config/vip-and-daily-allowance.sql').match(/create (?:or replace )?function public\.icash_reserve_question\([\s\S]*?end \$\$;/)?.[0];
 assert(pricing,'Real question pricing source found');await pg.exec(pricing);
 for(const [selected,n,expected] of [['vip',21,2.4],['standard',22,3],['vip',23,2.4]]){
  await plan(1,11,selected);
  await q("insert into icash_workspace_questions values($1,$2,'pending')",[id(n),id(11)]);
  await q("select icash_reserve_question($1,$2,'gpt-4.1-mini')",[id(11),id(n)]);
  assert.equal(Number((await one('select multiplier from icash_question_usage where question_id=$1',[id(n)])).multiplier),expected);
 }
 assert.equal(Number((await one('select multiplier from icash_question_usage where question_id=$1',[id(21)])).multiplier),2.4,'Later switching never reprices earlier work');
 await plan(1,11,'standard');assert.equal((await access(11)).vipFeatures,false);assert.equal((await one('select icash_vip_call_voice($1) v',[id(11)])).v,null);
 await assert.rejects(q('select icash_set_custom_voice_enabled($1,$2,true)',[id(1),id(11)]));
 await q("update icash_memberships set vip_until=now()+interval '1 day' where account_id=$1",[id(12)]);assert.equal((await access(12)).vip,true,'Paid customer VIP remains unchanged');
 await q("update icash_memberships set vip_until=null where account_id=$1",[id(12)]);
 await plan(1,11,'vip');await q("update icash_accounts set owner_user_id=$1 where id=$2",[id(2),id(11)]);assert.equal((await access(11)).vip,false,'Account transfer invalidates admin override');
 await q("update icash_accounts set owner_user_id=$1,billing_model='membership_credits' where id=$2",[id(1),id(11)]);
 await q("update icash_memberships set state='payment_failed' where account_id=$1",[id(11)]);assert.equal((await access(11)).vip,false);await assert.rejects(plan(1,11,'vip'));
 await q("update icash_memberships set state='active' where account_id=$1",[id(11)]);
 await plan(1,11,'standard');await q("update icash_memberships set vip_until=now()+interval '1 day' where account_id=$1",[id(11)]);assert.equal((await access(11)).vip,false,'Standard overrides even paid VIP for the admin');
 await q("update icash_memberships set vip_until=null where account_id=$1",[id(11)]);
 assert.equal(await fingerprint(),adminBefore,'Plan switching never changes subscription records or credits');
 for(const role of ['anon','authenticated']){
  for(const permission of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await one("select has_table_privilege($1,'icash_admin_plans',$2) v",[role,permission])).v,false);
  assert.equal((await one("select has_function_privilege($1,'icash_set_admin_plan(uuid,uuid,text)','EXECUTE') v",[role])).v,false);
 }
 assert.equal((await one("select relrowsecurity v from pg_class where relname='icash_admin_plans'")).v,true);
 console.log('PASS actual admin plans: durable VIP/Standard, correct real usage multipliers, voice gates, customer isolation, prepaid access, account binding, membership lock, unchanged credits and subscriptions.');
}finally{await pg.close();}
