import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const one=async(s,p=[])=>(await pg.query(s,p)).rows[0];
const account=randomUUID(),bundle=randomUUID(),signing=randomUUID(),suffix=':standing-delivery-20261014';
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_operating_budget(id integer primary key);insert into icash_operating_budget values(1);
 create table icash_operation_rates(id uuid primary key default gen_random_uuid(),operation text,version text unique,charge_cents bigint,costs_micros jsonb,buffer_bps integer,evidence_ref text,verified_at timestamptz,expires_at timestamptz,enabled boolean,flat_customer_price_cents bigint,voice_max_duration_seconds integer);
 create table icash_text_ai_settings(id integer primary key,model text,rate_id uuid,enabled boolean default true);
 insert into icash_text_ai_settings values(1,'gpt-4.1-mini',null,true);
 create table icash_text_threads(id uuid primary key,account_id uuid,sms_rate_id uuid,paused boolean default false,manual_only boolean default false,ai_mode text default 'auto',retired_at timestamptz,seller_intake_id uuid,seller_sms_rate_hash text,seller_sms_price_micros bigint,operational_contact_id uuid,operational_sms_rate_hash text,operational_sms_price_micros bigint,owner_buyer_test_id uuid,sms_review_request_id uuid,eligibility_until timestamptz,permission_until timestamptz,permission_evidence text,contact_ok boolean default true);
 create table icash_operational_contacts(id uuid primary key,account_id uuid,eligibility_until timestamptz);
 create table icash_signing_templates(id uuid primary key default gen_random_uuid(),provider text default 'docuseal',enabled boolean default true,test_mode boolean default false,rate_id uuid,reviewed_until timestamptz,form_profile text);
 create table icash_communication_prices(operation text primary key,customer_micros bigint);insert into icash_communication_prices values('sms_segment',90000);
 create table icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,direction text,state text,provider_id text,last_delivery_at timestamptz,customer_price_micros bigint);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,state text,reserved_micros bigint,charge_cap_cents bigint,standard_cost_multiplier numeric,customer_price_micros bigint,charged_cents bigint,actual_micros bigint,cost_basis text);
 create table icash_text_ai_jobs(id uuid primary key,account_id uuid,provider_id text,usage jsonb);
 -- Contact admission is represented by a fixture predicate. The migration must
 -- still call it after rate rebinding and roll back every rejected thread.
 create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select contact_ok from icash_text_threads where id=$2 and account_id=$1$$;
 create function icash_claim_text_ai_before_campaign(p_account uuid,p_job uuid) returns jsonb language plpgsql as $$declare c public.icash_text_ai_settings;begin
 select * into c from public.icash_text_ai_settings where id=1;
 if not exists(select 1 from public.icash_operation_rates where id=c.rate_id and operation='sms_ai' and enabled and expires_at>now()) then return null;end if;
 return jsonb_build_object('model',c.model);end$$;
 create function icash_save_text_ai(uuid,uuid,jsonb,text,text,jsonb) returns void language plpgsql as $$begin null;end$$;
 create function icash_settle_estimated_operation(text) returns boolean language sql as $$select false$$;
 -- Ledger delegate spy: the real token settlement function supplies actual cost.
 create function icash_settle_complete_costs(p_operation text,p_charge bigint,p_components jsonb,p_evidence text) returns void language plpgsql as $$begin
 update public.icash_operation_spend set state='settled',charged_cents=p_charge,actual_micros=(p_components->'llm'->>'amountMicros')::bigint where operation_key=p_operation;end$$;`);
 await pg.query("insert into icash_operation_rates values($1,'sms_send','bundled-historical',9,'{\"llm\":20000,\"messaging\":10000,\"other\":0}',0,'Existing reviewed estimate',now(),now()+interval '7 days',true,null,null)",[bundle]);
 await pg.exec(read('config/sms-ai-token-billing.sql'));
 const oldSms=(await one("select id from icash_operation_rates where version='sms-transport-with-separate-ai-20261007'")).id;
 const oldAi=(await one('select rate_id from icash_text_ai_settings')).rate_id;
 await pg.query("update icash_operation_rates set verified_at=now()-interval '7 days',expires_at=now()-interval '1 hour' where id=any($1::uuid[])",[[oldSms,oldAi]]);
 await pg.query("insert into icash_operation_rates values($1,'contract_signing','signing-reviewed',265,'{\"messaging\":400000,\"title_and_signing\":200000}',2000,'Existing signing pricing evidence',now()-interval '2 days',now()+interval '14 days',true,null,null)",[signing]);
 const live=(await one("insert into icash_signing_templates(rate_id,reviewed_until,form_profile) values($1,now()+interval '60 days','owner_original_20261009') returning id",[signing])).id;
 const disabled=(await one("insert into icash_signing_templates(enabled,rate_id,reviewed_until) values(false,$1,now()+interval '60 days') returning id",[signing])).id;
 const test=(await one("insert into icash_signing_templates(test_mode,rate_id,reviewed_until) values(true,$1,now()+interval '60 days') returning id",[signing])).id;
 const originalRates=(await pg.query('select to_jsonb(r) row from icash_operation_rates r order by id')).rows;
 await pg.exec(`create function icash_immutable_operation_rate() returns trigger language plpgsql as $$begin
 if (to_jsonb(new)-'enabled') is distinct from (to_jsonb(old)-'enabled') then raise exception 'Create a new rate version instead of changing evidence';end if;return new;end$$;
 create trigger icash_operation_rate_immutable before update on icash_operation_rates for each row execute function icash_immutable_operation_rate();`);
 const oldHash=(await one("select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') hash from icash_operation_rates r where id=$1",[oldSms])).hash;
 const cases={};
 for(const kind of ['eligible','revoked','paused','test','bad_hash','legacy']){
  const id=randomUUID();cases[kind]=id;
  await pg.query("insert into icash_text_threads(id,account_id,sms_rate_id,seller_intake_id,seller_sms_rate_hash,seller_sms_price_micros,permission_until,permission_evidence,contact_ok,paused,owner_buyer_test_id,sms_review_request_id) values($1,$2,$3,$4,$5,30000,now()+interval '29 days','original-consent',$6,$7,$8,$9)",
   [id,account,oldSms,randomUUID(),kind==='bad_hash'?'stale':oldHash,kind!=='revoked',kind==='paused',kind==='test'?randomUUID():null,kind==='legacy'?randomUUID():null]);
 }
 const originalThreads=(await pg.query('select id,to_jsonb(t) row from icash_text_threads t')).rows;
 const migration=read('config/standing-contract-messaging-approval.sql');
 await pg.exec(migration);
 const newAi=(await one('select rate_id from icash_text_ai_settings')).rate_id;
 const newSms=(await one('select id from icash_operation_rates where version=$1',['sms-transport-with-separate-ai-20261007'+suffix])).id;
 assert.notEqual(newAi,oldAi);assert.notEqual(newSms,oldSms);
 assert.equal((await one("select count(*)::int n from icash_operation_rates where expires_at='9999-12-31T23:59:59Z'")).n,3);
 for(const {row} of originalRates)assert.deepEqual((await one('select to_jsonb(r) row from icash_operation_rates r where id=$1',[row.id])).row,row,'historical rate immutable');
 for(const {id,row} of originalThreads){
  const actual=(await one('select to_jsonb(t) row from icash_text_threads t where id=$1',[id])).row;
  if(id===cases.eligible){assert.equal(actual.sms_rate_id,newSms);assert.equal(actual.permission_until,row.permission_until);assert.equal(actual.permission_evidence,row.permission_evidence);}
  else assert.deepEqual(actual,row,'noncurrent/test/manual review thread preserved');
 }
 assert.equal((await one("select reviewed_until='9999-12-31T23:59:59Z' ok from icash_signing_templates where id=$1",[live])).ok,true);
 for(const id of [disabled,test])assert.equal((await one('select rate_id from icash_signing_templates where id=$1',[id])).rate_id,signing);
 const beforeRetry=(await pg.query('select to_jsonb(r) row from icash_operation_rates r order by id')).rows;
 await pg.exec(migration);
 assert.deepEqual((await pg.query('select to_jsonb(r) row from icash_operation_rates r order by id')).rows,beforeRetry,'idempotent rate versions');
 // New and historical AI rate versions both retain actual-token accounting.
 for(const rate of [oldAi,newAi]){
  const job=randomUUID();
  await pg.query('insert into icash_text_ai_jobs values($1,$2,$3,$4)',[job,account,'chatcmpl-'+job,{prompt_tokens:1000,prompt_tokens_details:{cached_tokens:500},completion_tokens:100}]);
  await pg.query("insert into icash_operation_spend(operation_key,account_id,rate_id,state,reserved_micros,charge_cap_cents,standard_cost_multiplier) values($1,$2,$3,'dispatched',20000,6,3)",['sms-ai:'+job,account,rate]);
  assert.equal((await one('select icash_settle_estimated_operation($1) ok',['sms-ai:'+job])).ok,true);
  const result=await one('select * from icash_operation_spend where operation_key=$1',['sms-ai:'+job]);
  assert.equal(result.actual_micros,410);assert.equal(result.customer_price_micros,1230);assert.equal(result.rate_id,rate);
 }
 await pg.exec("update icash_text_ai_settings set model='unreviewed-model'");
 assert.equal((await one('select icash_claim_text_ai_before_campaign($1,$2) result',[account,randomUUID()])).result,null,'new version retains exact model binding');
 console.log('PASS standing delivery SQL: three immutable rate versions; idempotency; unchanged historical rates; original consent preserved; revoked/paused/test/stale-hash/legacy threads untouched; enabled live templates only; historical and new AI actual-token settlement; exact model binding. Contact admission and ledger delegates are local fixtures. No provider requests.');
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{await pg.close();}
