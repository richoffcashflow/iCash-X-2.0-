// One bounded title-correction race replay in local PostgreSQL; no email calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=await PGlite.create(),q=(s,a=[])=>db.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
const fn=(file,name)=>{const s=readFileSync(file,'utf8'),start=s.indexOf(`create function public.${name}(`);assert(start>=0);return s.slice(start,s.indexOf('$$;',s.indexOf('as $$',start)+5)+3);};
const account=randomUUID(),owner=randomUUID(),deal=randomUUID(),screen=randomUUID(),purchase=randomUUID(),oldRate=randomUUID(),newRate=randomUUID();
const save=async(action,data)=>(await one('select icash_save_closing_setup_before_profile($1,$2,$3,$4,$5) result',[account,owner,deal,action,data])).result;
const snapshot=j=>({accountId:j.account_id,dealId:j.deal_id,purchaseEnvelopeId:j.purchase_envelope_id,recipient:j.recipient,propertyAddress:j.property_address,rateId:j.rate_id,verifiedUntil:j.verified_until});
const claim=async(j)=>(await one('select icash_claim_title_request_snapshot($1,$2) ok',[j.id,snapshot(j)])).ok;
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
 create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb);
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean default false);
 create table icash_operation_rates(id uuid primary key,operation text,enabled boolean,expires_at timestamptz,verified_at timestamptz);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,state text default 'reserved',permission_until timestamptz);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table icash_closing_setup(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid unique,screening_id uuid,payout jsonb,title_proposal jsonb,state text default 'needs_review',review_reason text default 'setup',updated_at timestamptz default now());
 create table icash_closing_updates(account_id uuid,deal_id uuid,kind text);
 create function icash_set_work_control(uuid,uuid,text,uuid) returns void language sql as $$select$$;
 create function icash_reserve_operation(a uuid,k text,r uuid,u timestamptz) returns void language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.icash_operation_spend where operation_key=k and (account_id<>a or rate_id<>r)) then raise exception 'Operation conflict';end if;
 if u<=now() or not exists(select 1 from public.icash_operation_rates where id=r and enabled and expires_at>now()) then raise exception 'Current permission/rate required';end if;
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,permission_until) values(k,a,r,u) on conflict do nothing;end$$;
 create function icash_claim_operation(k text) returns boolean language plpgsql set search_path='' as $$begin
 update public.icash_operation_spend set state='dispatched' where operation_key=k and state='reserved' and permission_until>now();return found;end$$;
 `);
 await db.exec(readFileSync('config/title-requests.sql','utf8'));
 await db.exec(fn('config/closing-setup.sql','icash_title_contact_matches'));
 await db.exec(fn('config/closing-setup.sql','icash_save_closing_setup').replace('function public.icash_save_closing_setup(','function public.icash_save_closing_setup_before_profile('));
 await db.exec(`do $$declare def text;begin def:=pg_get_functiondef('icash_claim_title_request(uuid)'::regprocedure);execute replace(def,'lower(d.terms->>''titleEmail'') is distinct from lower(j.recipient)','not public.icash_title_contact_matches(j.account_id,j.deal_id,j.recipient)');end$$;`);
 const patch=readFileSync('config/title-request-snapshot.sql','utf8');assert.equal(readFileSync('supabase/migrations/20261014195346_title_request_snapshot.sql','utf8'),patch);await db.exec(patch);
 await q('insert into icash_accounts(id,owner_user_id) values($1,$2)',[account,owner]);
 await q(`insert into icash_screening_jobs values($1,$2,'{"propertyId":"fixture"}')`,[screen,account]);
 await q(`insert into icash_deal_files values($1,$2,$3,'under_contract','{"address":"100 Fixture Lane","titleEmail":""}')`,[deal,account,screen]);
 await q(`insert into icash_signing_envelopes values($1,$2,$3,'purchase','completed',false)`,[purchase,account,deal]);
 await q(`insert into icash_operation_rates values($1,'title_email',true,now()+interval '60 days',now()-interval '1 day'),($2,'title_email',true,now()+interval '60 days',now())`,[oldRate,newRate]);
 await q(`insert into icash_title_contacts values($1,$2,'old@example.invalid',now()+interval '1 day','owner-closing-verification:fixture',$3,true)`,[deal,account,oldRate]);
 await one('select icash_prepare_title_request($1,$2)',[account,deal]);
 const loaded=await one('select * from icash_title_requests');
 // Worker A has loaded the old recipient and is fetching the signed PDF.
 const preferred={company:'Buyer Title',closer:'Casey',email:'new@example.invalid',phone:'+12145550100'};
 await save('title_preference',preferred);
 const revision=(await one('select updated_at from icash_closing_setup')).updated_at;
 await save('confirm_title',{revision,independentContact:true,assignmentsAndCoverage:true,agreedByParties:true});
 const fresh=await one('select * from icash_title_requests');
 assert.equal(fresh.id,loaded.id);assert.equal(fresh.recipient,preferred.email);assert.equal(fresh.rate_id,newRate);assert.notEqual(fresh.verified_until,loaded.verified_until);
 // Worker A resumes after correction: no stale send AND no old reservation.
 assert.equal(await claim(loaded),false);assert.equal((await one('select count(*)::int n from icash_operation_spend')).n,0);
 assert.equal((await one('select icash_claim_title_request($1) ok',[fresh.id])).ok,false,'Old app instances fail closed');
 assert.equal(await claim({...fresh,account_id:randomUUID()}),false);
 assert.equal(await claim({...fresh,purchase_envelope_id:randomUUID()}),false);
 assert.equal(await claim(fresh),true);assert.equal(await claim(fresh),false);
 const reserved=await one('select * from icash_operation_spend');assert.equal(reserved.rate_id,newRate);assert.equal(reserved.state,'dispatched');
 // Any actual reservation/attempt stays immutable, including ambiguous work.
 await assert.rejects(save('title_preference',{...preferred,email:'third@example.invalid'}),/Request human review/);
 await q(`update icash_title_requests set state='needs_review',provider_id='fixture_receipt'`);
 await q(`update icash_title_contacts set email='other@example.invalid'`);
 await one('select icash_prepare_title_request($1,$2)',[account,deal]);
 const held=await one('select * from icash_title_requests');assert.equal(held.recipient,fresh.recipient);assert.equal(held.provider_id,'fixture_receipt');assert.equal(held.state,'needs_review');
 assert.equal(await claim(held),false);assert.equal((await one('select count(*)::int n from icash_operation_spend')).n,1);
 assert.equal((await one('select stage from icash_deal_files')).stage,'under_contract');
 for(const role of ['anon','authenticated'])assert.equal((await one(`select has_function_privilege($1,'icash_claim_title_request_snapshot(uuid,jsonb)','EXECUTE') ok`,[role])).ok,false);
 console.log('PASS title correction race: stale snapshot reserves/sends nothing; current verified draft claims once; attempted requests remain held. No email sent.');
}finally{await db.close();}
