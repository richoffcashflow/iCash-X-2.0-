// Five focused local PostgreSQL scenarios. No provider transport or paid usage.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=await PGlite.create();
const q=(sql,args=[])=>db.query(sql,args),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
const fn=(file,name)=>{const s=readFileSync(file,'utf8'),start=s.indexOf(`create function public.${name}(`);assert(start>=0);return s.slice(start,s.indexOf('$$;',s.indexOf('as $$',start)+5)+3);};
const account=randomUUID(),owner=randomUUID(),other=randomUUID(),deal=randomUUID(),screen=randomUUID(),envelope=randomUUID();
const payout={payeeName:'Fixture LLC',payeeType:'company',method:'wire',mailingAddress:'',detailsSharedWithTitle:false};
const save=(action,data,actor=owner)=>one('select icash_save_closing_setup($1,$2,$3,$4,$5) result',[account,actor,deal,action,data]);
const state=async()=>(await one('select state from icash_closing_setup where deal_id=$1',[deal])).state;
let passed=0;const pass=s=>console.log(`PASS ${++passed}/5 ${s}`);
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb,state text default 'complete');
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb default '{}');
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean default false);
 create table icash_title_contacts(deal_id uuid primary key,account_id uuid,email text,enabled boolean,verified_until timestamptz,evidence_ref text,rate_id uuid);
 create table icash_title_requests(id uuid primary key default gen_random_uuid(),deal_id uuid,account_id uuid,state text,recipient text);
 create table icash_operation_rates(id uuid primary key,operation text,enabled boolean,expires_at timestamptz,verified_at timestamptz);
 create table icash_closing_setup(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid unique,screening_id uuid,payout jsonb,title_proposal jsonb,state text default 'needs_review',review_reason text default 'setup',updated_at timestamptz default now());
 create table icash_closing_profiles(account_id uuid primary key,payout jsonb,title_proposal jsonb,updated_at timestamptz default now());
 create table icash_closing_updates(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,kind text,amount_cents bigint,effective_date date,confirmed_by uuid,confirmation_source text,reply_id uuid,created_at timestamptz default now());
 create table icash_title_replies(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,sender_verified boolean);
 create table icash_proceeds_receipts(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid unique,closing_update_id uuid,amount_cents bigint,received_date date,confirmed_by uuid);
 create table fixture_controls(account_id uuid,screening_id uuid,manual boolean,primary key(account_id,screening_id));
 create function icash_set_work_control_before_closing_setup(p_user uuid,p_account uuid,p_action text,p_screening uuid) returns void language plpgsql set search_path='' as $$begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Owner required';end if;
 insert into public.fixture_controls values(p_account,p_screening,p_action<>'return_to_bot') on conflict(account_id,screening_id) do update set manual=excluded.manual;end$$;
 `);
 const setup='config/closing-setup.sql';
 await db.exec(fn(setup,'icash_title_contact_matches'));
 await db.exec(fn(setup,'icash_save_closing_setup').replace('function public.icash_save_closing_setup(','function public.icash_save_closing_setup_before_profile('));
 await db.exec(fn(setup,'icash_set_work_control').replace('function public.icash_set_work_control(','function public.icash_set_work_control_before_cancellation('));
 await db.exec(`create function icash_set_work_control(p_user uuid,p_account uuid,p_action text,p_screening uuid) returns void language sql set search_path='' as $$select public.icash_set_work_control_before_cancellation(p_user,p_account,p_action,p_screening)$$;`);
 await db.exec(fn('config/turnkey-deal-journey.sql','icash_save_closing_setup'));
 await db.exec(fn('config/closing-completion.sql','icash_confirm_proceeds'));
 await q('insert into icash_accounts values($1,$2)',[account,owner]);
 await q(`insert into icash_screening_jobs(id,account_id,snapshot) values($1,$2,'{"propertyId":"fixture"}')`,[screen,account]);
 await q(`insert into icash_deal_files values($1,$2,$3,'under_contract','{}')`,[deal,account,screen]);
 await q(`insert into icash_signing_envelopes values($1,$2,$3,'purchase','awaiting_counterparty',false)`,[envelope,account,deal]);
 await assert.rejects(save('payout',payout),/Signed live purchase required/);
 await q(`update icash_signing_envelopes set state='completed'`);
 await q(`insert into icash_title_contacts values($1,$2,'closer@example.invalid',true,now()+interval '1 day','owner-closing-verification:fixture',null)`,[deal,account]);
 await save('payout',payout);assert.equal(await state(),'ready','Reproduces the prior hidden payout action');
 const patch=readFileSync('config/closing-payout-readiness.sql','utf8');
 assert.equal(readFileSync('supabase/migrations/20261014195124_closing_payout_readiness.sql','utf8'),patch);
 await db.exec(patch);assert.equal(await state(),'needs_review');
 pass('Only verified signing permits setup; missing secure payout details remain visible after repair');

 await save('payout',{...payout,detailsSharedWithTitle:true});assert.equal(await state(),'ready');
 await save('payout',payout);assert.equal(await state(),'needs_review','Editing completed setup must reopen the action');
 await one(`select icash_set_work_control($1,$2,'return_to_bot',$3)`,[owner,account,screen]);assert.equal(await state(),'needs_review');
 await assert.rejects(save('payout',{...payout,detailsSharedWithTitle:true},other),/Owner required/);
 pass('Saved preferences and Return to bot cannot hide unfinished payout work');

 await q('update icash_closing_setup set payout=null');
 await save('use_profile',{});assert.equal(await state(),'needs_review');
 assert.equal((await one('select payout from icash_closing_setup')).payout.detailsSharedWithTitle,false);
 await q('delete from icash_title_contacts');
 await save('title_preference',{company:'Buyer Title',closer:'Casey',email:'buyer-title@example.invalid',phone:'+12145550100'});
 await save('payout',{...payout,detailsSharedWithTitle:true});assert.equal(await state(),'needs_review');
 assert.equal((await one('select count(*)::int n from icash_title_contacts')).n,0);
 pass('Saved profiles and buyer-provided title suggestions never inherit verification');

 await save('takeover',{reason:'payment_change'});await save('payout',payout);
 assert.equal(await state(),'acknowledged');assert.equal((await one('select review_reason from icash_closing_setup')).review_reason,'payment_change');
 assert.equal((await one('select manual from fixture_controls')).manual,true);
 for(const stage of ['cancellation_pending','cancelled']){await q('update icash_deal_files set stage=$1',[stage]);await assert.rejects(save('payout',payout),/Signed live purchase required/);}
 pass('Payment-change handoffs remain manual; pending and cancelled deals cannot restart setup');

 await q(`update icash_deal_files set stage='closed'`);
 const today=(await one(`select (now() at time zone 'America/Chicago')::date d`)).d;
 const confirm=(id)=>one('select icash_confirm_proceeds($1,$2,$3,$4,$5) result',[account,owner,deal,id,today]);
 await assert.rejects(confirm(randomUUID()),/Current title payment confirmation/);
 const reply=(await one('insert into icash_title_replies(account_id,deal_id,sender_verified) values($1,$2,false) returning id',[account,deal])).id;
 const payment=(await one(`insert into icash_closing_updates(account_id,deal_id,kind,amount_cents,effective_date,confirmed_by,reply_id) values($1,$2,'funds_disbursed',1000000,$3,$4,$5) returning id`,[account,deal,today,owner,reply])).id;
 await assert.rejects(confirm(payment),/Current title payment confirmation/);assert.equal((await one('select count(*)::int n from icash_proceeds_receipts')).n,0);
 await q('update icash_title_replies set sender_verified=true where id=$1',[reply]);
 const receipt=(await confirm(payment)).result;assert.equal((await confirm(payment)).result,receipt);
 assert.equal((await one('select amount_cents from icash_proceeds_receipts')).amount_cents,1000000);
 pass('Closing alone creates no proceeds; verified disbursement and explicit receipt are required');
 assert.equal(passed,5);
}finally{await db.close();}
