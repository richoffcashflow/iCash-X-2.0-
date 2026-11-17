import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export const migrationPath='supabase/migrations/20261116235416_title_delivery_snapshot.sql';
export const read=p=>readFileSync(p,'utf8');
const fn=(file,name)=>{const source=read(file),start=source.indexOf(`create function public.${name}(`);assert(start>=0);return source.slice(start,source.indexOf('$$;',source.indexOf('as $$',start)+5)+3);};
export async function installTitleDeliveryFixture(db){
 await db.exec(`do $$begin create role anon;exception when duplicate_object then null;end$$;do $$begin create role authenticated;exception when duplicate_object then null;end$$;do $$begin create role service_role bypassrls;exception when duplicate_object then null;end$$;
 alter role service_role bypassrls;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
 create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb);
 create table icash_deal_files(id uuid primary key,account_id uuid references icash_accounts(id),screening_id uuid,stage text,terms jsonb);
 create table icash_signing_envelopes(id uuid primary key,account_id uuid references icash_accounts(id),deal_id uuid references icash_deal_files(id),kind text,state text,test_mode boolean default false,provider_id text,terms jsonb,terms_hash text,template_id uuid,recipients jsonb,created_at timestamptz default now());
 create table icash_operation_rates(id uuid primary key,operation text,enabled boolean,expires_at timestamptz,verified_at timestamptz);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,state text default 'reserved',permission_until timestamptz);
 create table icash_property_controls(account_id uuid references icash_accounts(id),property_id text,manual boolean);
 create table icash_closing_setup(id uuid primary key default gen_random_uuid(),account_id uuid references icash_accounts(id),deal_id uuid unique references icash_deal_files(id),screening_id uuid,payout jsonb,title_proposal jsonb,state text default 'needs_review',review_reason text default 'setup',updated_at timestamptz default now());
 create table icash_closing_updates(account_id uuid,deal_id uuid,kind text);
 create table icash_agreement_cancellations(account_id uuid,deal_id uuid,state text,late_activity boolean default false);
 create function icash_set_work_control(uuid,uuid,text,uuid) returns void language sql as $$select$$;
 create function icash_reserve_operation(a uuid,k text,r uuid,u timestamptz) returns void language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.icash_operation_spend where operation_key=k and (account_id<>a or rate_id<>r)) then raise exception 'Operation conflict';end if;
 if u<=now() or not exists(select 1 from public.icash_operation_rates where id=r and enabled and expires_at>now()) then raise exception 'Current permission/rate required';end if;
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,permission_until) values(k,a,r,u) on conflict do nothing;end$$;
 create function icash_claim_operation(k text) returns boolean language plpgsql set search_path='' as $$begin
 update public.icash_operation_spend set state='dispatched' where operation_key=k and state='reserved' and permission_until>now();return found;end$$;`);
 await db.exec(read('config/title-requests.sql'));
 await db.exec("alter table icash_title_requests add column delivered_assignment_ids uuid[] default '{}';alter table icash_title_requests add column delivered_payout jsonb");
 await db.exec(fn('config/closing-setup.sql','icash_title_contact_matches'));
 await db.exec(read('tests/fixtures/title-delivery-predecessors.sql'));
 for(const signature of ['icash_claim_title_request_snapshot(uuid,jsonb)','icash_claim_title_request_before_snapshot(uuid)','icash_save_closing_setup_before_profile(uuid,uuid,uuid,text,jsonb)','icash_signing_action_allowed(uuid,uuid)'])await db.exec(`revoke all on function public.${signature} from public,anon,authenticated;grant execute on function public.${signature} to service_role;`);
 await db.exec('grant usage on schema public to service_role;grant all on all tables in schema public to service_role;grant execute on all functions in schema public to service_role');
}
export async function deliveryCase(db,{assignment=true}={}){
 const c={account:randomUUID(),owner:randomUUID(),deal:randomUUID(),screen:randomUUID(),purchase:randomUUID(),assignment:assignment?randomUUID():null,rate:randomUUID(),template:randomUUID()};
 c.terms={address:'100 Fixture Lane',titleEmail:'closer@example.invalid',assignee:'Current buyer'};
 c.payout={payeeName:'Fixture LLC',payeeType:'company',method:'check_pickup',mailingAddress:'',detailsSharedWithTitle:false};
 await db.query('insert into icash_accounts(id,owner_user_id) values($1,$2)',[c.account,c.owner]);
 await db.query('insert into icash_screening_jobs values($1,$2,$3)',[c.screen,c.account,{propertyId:'fixture-'+c.deal}]);
 await db.query("insert into icash_deal_files values($1,$2,$3,'under_contract',$4)",[c.deal,c.account,c.screen,c.terms]);
 c.envelope=async(id,kind='assignment',terms=c.terms,connection=db)=>connection.query("insert into icash_signing_envelopes(id,account_id,deal_id,kind,state,test_mode,provider_id,terms,terms_hash,template_id,recipients) values($1,$2,$3,$4,'completed',false,$5,$6,$7,$8,$9)",[id,c.account,c.deal,kind,'original-'+id,terms,'a'.repeat(64),c.template,JSON.stringify([{id:'1',email:'party@example.invalid'}])]);
 await c.envelope(c.purchase,'purchase');if(c.assignment)await c.envelope(c.assignment);
 await db.query("insert into icash_operation_rates values($1,'title_email',true,now()+interval '60 days',now())",[c.rate]);
 await db.query("insert into icash_title_contacts values($1,$2,'closer@example.invalid',now()+interval '1 day','fixture-independent-contact',$3,true)",[c.deal,c.account,c.rate]);
 await db.query('insert into icash_closing_setup(account_id,deal_id,screening_id,payout) values($1,$2,$3,$4)',[c.account,c.deal,c.screen,c.payout]);
 await db.query('select icash_prepare_title_request($1,$2)',[c.account,c.deal]);
 c.job=(await db.query('select *,verified_until::text as verified_until from icash_title_requests where account_id=$1 and deal_id=$2',[c.account,c.deal])).rows[0];
 c.legacy={id:c.job.id,accountId:c.account,dealId:c.deal,purchaseEnvelopeId:c.purchase,recipient:c.job.recipient,propertyAddress:c.job.property_address,rateId:c.rate,verifiedUntil:c.job.verified_until};
 c.snapshot=async()=>(await db.query('select icash_title_request_delivery_snapshot($1,$2) x',[c.account,c.job.id])).rows[0].x;
 c.claim=async(s)=>(await db.query('select icash_claim_title_request_snapshot($1,$2) ok',[c.job.id,s])).rows[0].ok;
 c.spends=async()=>(await db.query('select count(*)::int n from icash_operation_spend where account_id=$1',[c.account])).rows[0].n;
 c.replace=async(connection=db)=>{await connection.query("update icash_signing_envelopes set state='cancelled' where id=$1",[c.assignment]);const id=randomUUID();await c.envelope(id,'assignment',c.terms,connection);return id;};
 c.setPayout=async(payout,connection=db)=>connection.query("select icash_save_closing_setup_before_profile($1,$2,$3,'payout',$4)",[c.account,c.owner,c.deal,payout]);
 return c;
}
export async function deliveryMetadata(db){return (await db.query("select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) source_hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl from pg_proc where oid in ('icash_claim_title_request_snapshot(uuid,jsonb)'::regprocedure,'icash_claim_title_request_before_snapshot(uuid)'::regprocedure) order by 1")).rows;}
export async function runTitleDeliveryFixture(db,{beforeMigration}={}){
 await installTitleDeliveryFixture(db);
 const before=await deliveryMetadata(db);
 assert.equal(before.find(x=>x.signature==='icash_claim_title_request_snapshot(uuid,jsonb)').source_hash,'2d913f4e2de09e1c9804681126e0e493');
 const stale=await deliveryCase(db);await stale.replace();assert.equal(await stale.claim(stale.legacy),true,'Reproduced original snapshot admits a loaded cancelled assignment after replacement');
 const payout=await deliveryCase(db);await payout.setPayout({...payout.payout,payeeName:'Changed fixture LLC'});assert.equal(await payout.claim(payout.legacy),true,'Reproduced original snapshot admits a stale loaded payout preference');
 const migration=read(migrationPath);assert.equal(migration,read('config/title-delivery-snapshot.sql'));
 await db.exec('grant execute on function icash_claim_title_request_snapshot(uuid,jsonb) to authenticated');await assert.rejects(db.exec('begin;'+migration+'commit;'),/prerequisite changed/);await db.exec('rollback;revoke execute on function icash_claim_title_request_snapshot(uuid,jsonb) from authenticated');
 assert.equal((await db.query("select to_regprocedure('icash_title_request_delivery_snapshot(uuid,uuid)') x")).rows[0].x,null);
 const original=(await db.query("select pg_get_functiondef('icash_claim_title_request_snapshot(uuid,jsonb)'::regprocedure) x")).rows[0].x;
 await db.exec("create or replace function icash_claim_title_request_snapshot(p_id uuid,p_expected jsonb) returns boolean language plpgsql security invoker set search_path='' as $$begin return false;end$$");await assert.rejects(db.exec('begin;'+migration+'commit;'),/prerequisite changed/);await db.exec('rollback');await db.exec(original);
 assert.deepEqual(await deliveryMetadata(db),before);
 if(beforeMigration)await beforeMigration(migration,before);
 await db.exec('begin;'+migration+'commit;');
 const after=await deliveryMetadata(db);assert.deepEqual(after.map((x,i)=>({...x,source_hash:before[i].source_hash})),before);
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/prerequisite changed/);await db.exec('rollback');
 const cases=[
  ['replacement',async c=>c.replace()],
  ['assignment appeared',async c=>c.envelope(randomUUID()),{assignment:false}],
  ['assignment provider',async c=>db.query("update icash_signing_envelopes set provider_id='different-original' where id=$1",[c.assignment])],
  ['assignment recipient',async c=>db.query("update icash_signing_envelopes set recipients='[]' where id=$1",[c.assignment])],
  ['assignment terms',async c=>db.query("update icash_signing_envelopes set terms=terms||'{\"assignee\":\"Different buyer\"}' where id=$1",[c.assignment])],
  ['purchase provider',async c=>db.query("update icash_signing_envelopes set provider_id='different-original' where id=$1",[c.purchase])],
  ['deal terms',async c=>db.query("update icash_deal_files set terms=terms||'{\"address\":\"Changed address\"}' where id=$1",[c.deal])],
  ['payout',async c=>c.setPayout({...c.payout,payeeName:'Changed fixture LLC'})],
  ['new payout row',async c=>db.query('delete from icash_closing_setup where deal_id=$1',[c.deal])],
  ['Pause',async c=>db.query('update icash_accounts set bot_paused=true where id=$1',[c.account])],
  ['manual',async c=>db.query('insert into icash_property_controls values($1,$2,true)',[c.account,'fixture-'+c.deal])],
  ['late cancellation',async c=>db.query("insert into icash_agreement_cancellations values($1,$2,'completed',true)",[c.account,c.deal])],
 ];
 for(const [name,change,options] of cases){const c=await deliveryCase(db,options),source=await c.snapshot();assert(source,name+' initial snapshot');await change(c);assert.equal(await c.claim(source),false,name+' held');if(!['Pause','manual'].includes(name))assert.equal(await c.spends(),0,name+' makes no reservation');}
 const current=await deliveryCase(db),source=await current.snapshot();assert(source);assert.equal(await current.claim(current.legacy),false,'Old workers lack attachment proof');assert.equal(await current.spends(),0);
 const wrongAddress=await deliveryCase(db);await db.query("update icash_title_requests set property_address='Stale address' where id=$1",[wrongAddress.job.id]);assert.equal(await wrongAddress.snapshot(),null,'An already stale request caption is not a current delivery source');
 assert.equal(await current.claim({...source,request:{...source.request,accountId:randomUUID()}}),false);assert.equal(await current.spends(),0);
 await db.exec('set role service_role');assert.equal(await current.claim(source),true);await db.exec('reset role');assert.equal(await current.claim(source),false);assert.equal(await current.spends(),1);
 assert.equal((await db.query('select state from icash_title_requests where id=$1',[current.job.id])).rows[0].state,'dispatching');
 for(const state of ['sent','needs_review','dispatching']){const c=await deliveryCase(db),source=await c.snapshot();await db.query('update icash_title_requests set state=$2,provider_id=$3 where id=$1',[c.job.id,state,'original-receipt']);assert.equal(await c.claim(source),false);assert.equal(await c.spends(),0);assert.equal(await c.snapshot(),null);}
 for(const role of ['anon','authenticated'])for(const signature of ['icash_title_request_delivery_snapshot(uuid,uuid)','icash_claim_title_request_snapshot(uuid,jsonb)'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') ok',[role,signature])).rows[0].ok,false);
 console.log('PASS initial title source: reproduced stale assignment and payout admission, exact loaded sources now hold before reservation, current source claims once, old workers and unknown receipts stay held.');
 return {before,after};
}
