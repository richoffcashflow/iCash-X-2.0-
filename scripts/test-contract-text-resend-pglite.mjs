import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const q=(s,a=[])=>pg.query(s,a);
try{
 await pg.exec('create role anon;create role authenticated;create role service_role;');
 const names=['icash_accounts','icash_signing_envelopes','icash_text_threads','icash_text_messages','icash_deal_files','icash_text_suppressions'];
 for(const t of JSON.parse(read('tests/fixtures/automatic-credits-baseline.json')).tables.filter(t=>names.includes(t.name)))await pg.exec(t.definition);
 await pg.exec(`create table public.icash_contract_text_deliveries(envelope_id uuid,signer_id text,account_id uuid,thread_id uuid,message_id uuid);
 create function public.icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select not paused from public.icash_text_threads where account_id=$1 and id=$2$$;`);
 await pg.exec(read('supabase/migrations/20261009010519_contract_text_resend.sql'));
 const account=uuid(),other=uuid(),deal=uuid(),env=uuid(),thread=uuid(),message=uuid(),retry=uuid(),phone='+12025550100',hash='a'.repeat(64),termsHash='b'.repeat(64);
 await q('insert into icash_accounts(id) values($1),($2)',[account,other]);
 await q("insert into icash_deal_files(id,account_id,terms) values($1,$2,'{}')",[deal,account]);
 await q("insert into icash_signing_envelopes(id,account_id,deal_id,kind,terms,terms_hash,recipients,test_mode,provider_id,state) values($1,$2,$3,'purchase','{}',$4,$5,false,'123','awaiting_counterparty')",[env,account,deal,termsHash,JSON.stringify([{id:'1',phone},{id:'2',email:'owner@example.invalid'}])]);
 await q("insert into icash_text_threads(id,account_id,deal_id,sender,recipient,paused,party) values($1,$2,$3,'+12025550101',$4,false,'seller')",[thread,account,deal,phone]);
 await q("insert into icash_text_messages(id,account_id,thread_id,state,provider_id) values($1,$2,$3,'delivered','fixture-provider-message')",[message,account,thread]);
 await q("insert into icash_contract_text_deliveries values($1,'1',$2,$3,$4)",[env,account,thread,message]);
 const insert=()=>q("insert into icash_contract_text_resends(id,account_id,envelope_id,signer_id,original_message_id,recipient,expected_provider_id,expected_submitter_id,terms_hash,token_hash,authorization_ref,expires_at) values($1,$2,$3,'1',$4,$5,'123',321,$6,$7,'Explicit fixture authorization only',now()+interval '10 minutes')",[retry,account,env,message,phone,termsHash,hash]);
 const claim=async()=> (await q('select icash_claim_contract_text_resend($1) job',[hash])).rows[0].job;
 await insert();
 for(const [sql,args,undo,undoArgs] of [
  ["update icash_contract_text_resends set expires_at=now()-interval '1 second'",[],"update icash_contract_text_resends set expires_at=now()+interval '10 minutes'",[]],
  ['update icash_contract_text_resends set account_id=$1',[other],'update icash_contract_text_resends set account_id=$1',[account]],
  ["update icash_contract_text_resends set recipient='+12025550199'",[],"update icash_contract_text_resends set recipient=$1",[phone]],
  ["update icash_signing_envelopes set test_mode=true",[],"update icash_signing_envelopes set test_mode=false",[]],
  ["update icash_signing_envelopes set terms_hash='changed'",[],"update icash_signing_envelopes set terms_hash=$1",[termsHash]],
  ["update icash_deal_files set terms='{\"price\":1}'",[],"update icash_deal_files set terms='{}'",[]],
  ["update icash_text_threads set paused=true",[],"update icash_text_threads set paused=false",[]],
  ["insert into icash_text_suppressions(phone) values($1)",[phone],"delete from icash_text_suppressions",[]],
  ["update icash_text_messages set state='queued'",[],"update icash_text_messages set state='delivered'",[]],
  ["update icash_contract_text_deliveries set signer_id='2'",[],"update icash_contract_text_deliveries set signer_id='1'",[]]
 ]){await q(sql,args);assert.equal(await claim(),null,sql);await q(undo,undoArgs);}
 assert.equal((await claim()).submitterId,321);assert.equal(await claim(),null,'spent capability cannot dispatch twice');
 await assert.rejects(insert(),/duplicate key/,'one fallback per existing signer');
 for(const role of ['anon','authenticated']){
  await pg.exec('set role '+role);
  await assert.rejects(q('select * from icash_contract_text_resends'),/permission denied/);
  await assert.rejects(claim(),/permission denied/);
  await pg.exec('reset role');
 }
 assert.equal((await q("select relrowsecurity from pg_class where relname='icash_contract_text_resends'")).rows[0].relrowsecurity,true);
 console.log('PASS SQL one-use claims, expired authorization, account/phone/terms/original-message binding, current permission, suppression, RLS and private RPC.');
}finally{await pg.close();}
