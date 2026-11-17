import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
export const originalSourceMigration='supabase/migrations/20261116231524_title_original_source.sql';
export const recorderSignature='public.icash_record_title_reply(uuid,text,uuid,text,text,text,boolean)';
export const sourceSignature='public.icash_record_title_reply_source(uuid,text,uuid,text,text,text,boolean,jsonb)';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export async function originalSourceMetadata(db,signature=recorderSignature){return (await db.query("select md5(pg_get_functiondef(oid)) source_hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text from pg_proc where oid=$1::regprocedure",[signature])).rows[0];}
export async function installOriginalSourceFixture(db){
 await db.exec(`do $$begin create role anon;exception when duplicate_object then null;end$$;
 do $$begin create role authenticated;exception when duplicate_object then null;end$$;
 do $$begin create role service_role bypassrls;exception when duplicate_object then null;end$$;
 alter role service_role bypassrls;
 create table public.icash_accounts(id uuid primary key);
 create table public.icash_deal_files(id uuid primary key,account_id uuid,stage text);
 create table public.icash_title_requests(id uuid primary key,account_id uuid,deal_id uuid,recipient text,state text);
 create table public.icash_title_directory(id uuid primary key,public_email text);
 create table public.icash_title_qualification_jobs(id uuid primary key,account_id uuid,company_id uuid,state text);`);
 await db.exec(readFileSync('config/title-inbound.sql','utf8'));
 await db.exec(readFileSync('config/title-tasks.sql','utf8'));
 await db.exec(readFileSync('tests/fixtures/title-original-source-predecessor.sql','utf8'));
 await db.exec('grant usage on schema public to service_role;grant all on all tables in schema public to service_role');
}
export async function originalSourceCase(db){
 const account=randomUUID(),deal=randomUUID(),request=randomUUID();
 await db.query('insert into public.icash_accounts values($1)',[account]);
 await db.query("insert into public.icash_deal_files values($1,$2,'under_contract')",[deal,account]);
 await db.query("insert into public.icash_title_requests values($1,$2,$3,'closer@example.invalid','sent')",[request,account,deal]);
 return {account,deal,request};
}
export async function recordOriginalSource(db,c,text,{email=randomUUID(),authenticated=true,sender='closer@example.invalid',legacy=false,kind='T',source={}}={}){
 const metadata={providerReceivedAt:'2026-01-02T03:04:05.678Z',webhookEventId:'fixture-'+randomUUID(),bodyComplete:true,bodySha256:sha256(text),...source};
 const args=[email,kind,c.request,sender,'Fixture title source',text,authenticated];
 if(legacy)await db.query('select public.icash_record_title_reply($1,$2,$3,$4,$5,$6,$7)',args);
 else await db.query('select public.icash_record_title_reply_source($1,$2,$3,$4,$5,$6,$7,$8)',[...args,metadata]);
 return (await db.query('select * from public.icash_title_replies where provider_email_id=$1',[email])).rows[0];
}
export async function runOriginalSourceFixture(db,{beforeMigration}={}){
 await installOriginalSourceFixture(db);
 const before=await originalSourceMetadata(db);assert.equal(before.source_hash,'7099858010d088ee8a70b57e2741e9ac');
 const historical=await originalSourceCase(db),old=await recordOriginalSource(db,historical,'Original historical reply',{legacy:true});
 const oldTasks=(await db.query('select * from public.icash_title_tasks where reply_id=$1',[old.id])).rows;
 const migration=readFileSync(originalSourceMigration,'utf8');assert.equal(migration,readFileSync('config/title-original-source.sql','utf8'));
 await db.exec('grant execute on function '+recorderSignature+' to authenticated');
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/predecessor changed/);await db.exec('rollback');
 assert.equal((await db.query("select to_regnamespace('icash_title_inbound_private') found")).rows[0].found,null);
 await db.exec('revoke execute on function '+recorderSignature+' from authenticated');
 if(beforeMigration)await beforeMigration(migration,before);
 await db.exec('begin;'+migration+'commit;');
 assert.deepEqual(await originalSourceMetadata(db),before,'Legacy recorder source and full permissions remain unchanged');
 const historicalAfter=(await db.query('select * from public.icash_title_replies where id=$1',[old.id])).rows[0];assert.deepEqual(historicalAfter,{...old,original_source:{}});
 assert.deepEqual((await db.query('select * from public.icash_title_tasks where reply_id=$1',[old.id])).rows,oldTasks,'No historical review flags or tasks are reset');
 const c=await originalSourceCase(db),text='ICASH CONFIRMATION\nStatus: closed\nDate: 2026-01-02\nAmount cents: none\nFile: original-file\nEND ICASH CONFIRMATION';
 const reply=await recordOriginalSource(db,c,text),evidence=reply.original_source;
 assert.equal(reply.sender_verified,true);assert.equal(evidence.version,1);assert(evidence.revision>0);
 assert.equal(Date.parse(evidence.providerReceivedAt),Date.parse('2026-01-02T03:04:05.678Z'),'Delayed processing keeps original provider time');
 assert(Date.parse(reply.received_at)>Date.parse(evidence.providerReceivedAt));
 assert.equal(evidence.bodyComplete,true);assert.equal(evidence.bodySha256,sha256(text));assert.equal(evidence.subjectSha256,sha256(reply.subject));
 assert.deepEqual([evidence.providerEmailId,evidence.accountId,evidence.dealId,evidence.requestId,evidence.sender],[reply.provider_email_id,c.account,c.deal,c.request,reply.sender]);
 const duplicate=await recordOriginalSource(db,c,'Changed duplicate must never replace the original',{email:reply.provider_email_id,source:{providerReceivedAt:'2026-11-16T23:59:00Z'}});assert.deepEqual(duplicate,reply);
 assert.equal((await db.query("select count(*)::int n from public.icash_title_tasks where reply_id=$1 and kind='reply_review'",[reply.id])).rows[0].n,1);
 assert.equal((await db.query('select stage from public.icash_deal_files where id=$1',[c.deal])).rows[0].stage,'under_contract','Evidence capture alone creates no closing milestone');
 for(const options of [{authenticated:false},{sender:'impostor@example.invalid'}]){const unverified=await recordOriginalSource(db,await originalSourceCase(db),text,options);assert.equal(unverified.sender_verified,false);assert.equal(unverified.account_id,null);assert.deepEqual(unverified.original_source,{});}
 const unbound=await recordOriginalSource(db,{request:randomUUID()},text);assert.equal(unbound.account_id,null);assert.deepEqual(unbound.original_source,{});
 const forged=await recordOriginalSource(db,await originalSourceCase(db),text,{source:{providerEmailId:randomUUID(),accountId:randomUUID(),requestId:randomUUID(),sender:'forged@example.invalid'}});assert.equal(forged.original_source.providerEmailId,forged.provider_email_id);assert.equal(forged.original_source.accountId,forged.account_id);assert.equal(forged.original_source.requestId,forged.request_id);assert.equal(forged.original_source.sender,forged.sender);
 const company=randomUUID(),qualification=randomUUID();await db.query("insert into public.icash_title_directory values($1,'closer@example.invalid')",[company]);await db.query("insert into public.icash_title_qualification_jobs values($1,$2,$3,'sent')",[qualification,c.account,company]);
 const qualified=await recordOriginalSource(db,{...c,request:qualification},text,{kind:'Q'});assert.equal(qualified.sender_verified,true);assert.equal(qualified.account_id,c.account);assert.equal(qualified.deal_id,null);assert.equal(qualified.qualification_id,qualification);assert.deepEqual(qualified.original_source,{},'Qualification replies never gain deal-closing evidence');
 const legacy=await recordOriginalSource(db,await originalSourceCase(db),text,{legacy:true});assert.deepEqual(legacy.original_source,{});
 for(const source of [{bodyComplete:false},{bodySha256:'0'.repeat(64)}]){const invalid=await recordOriginalSource(db,await originalSourceCase(db),text,{source});assert.equal(invalid.original_source.bodyComplete,false);assert.equal(invalid.original_source.bodySha256,null);}
 for(const providerReceivedAt of [null,'bad-time','2026-02-30T10:00:00Z']){const missing=await recordOriginalSource(db,await originalSourceCase(db),text,{source:{providerReceivedAt}});assert.equal(missing.original_source.providerReceivedAt,null);}
 const capped=await recordOriginalSource(db,await originalSourceCase(db),'x'.repeat(20001));assert.equal(capped.body_text.length,20000);assert.equal(capped.original_source.bodyComplete,false);
 await assert.rejects(db.query("update public.icash_title_replies set original_source='{}' where id=$1",[reply.id]),/immutable/);
 await assert.rejects(db.query('update public.icash_title_replies set original_source=$2 where id=$1',[legacy.id,evidence]),/immutable/,'Legacy rows cannot be enriched/replayed later');
 await db.query('update public.icash_title_replies set needs_review=false where id=$1',[reply.id]);assert.equal((await db.query('select needs_review from public.icash_title_replies where id=$1',[reply.id])).rows[0].needs_review,false);
 for(const role of ['anon','authenticated'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,sourceSignature])).rows[0].allowed,false);
 const created=await originalSourceMetadata(db,sourceSignature);assert.deepEqual({...created,source_hash:before.source_hash},before,'New recorder retains invoker mode, owner, empty search path and private ACL');
 console.log('PASS title source foundation: exact old recorder retained, original provider time/body/account binding preserved, duplicate events immutable, no historical replay or status advancement. New RPC MD5: '+created.source_hash);
 return {before,created};
}
