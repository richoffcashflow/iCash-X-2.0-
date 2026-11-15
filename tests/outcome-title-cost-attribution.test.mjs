// Execute the real forward SQL locally. No title emails, provider calls or billing.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const patch=read('config/outcome-title-cost-attribution.sql');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const db=new PGlite(),q=(sql,args=[])=>db.query(sql,args),val=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb);
 create table icash_disposition_authorities(deal_id uuid primary key,account_id uuid,market text,expires_at timestamptz,purchase_envelope_id uuid);
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,state text,test_mode boolean);
 create table icash_title_contacts(deal_id uuid,account_id uuid,enabled boolean,verified_until timestamptz);
 create table icash_operation_spend(operation_key text primary key,state text);
 `);
 await db.exec(read('config/title-directory.sql'));
 // A changed upstream queue must be reviewed instead of silently overwritten.
 await db.exec(`begin;create or replace function icash_queue_title_qualification(p_account uuid,p_deal uuid) returns void language plpgsql as $$begin return;end$$;`);
 await assert.rejects(db.exec(patch),/Reviewed title qualification queue source required/);
 await db.exec('rollback');
 await q('insert into icash_accounts values($1),($2)',[id(1),id(2)]);
 const deal=async(n,account=1,market='Dallas')=>{
  await q('insert into icash_screening_jobs values($1,$2,$3)',[id(n+1000),id(account),{propertyId:'property-'+n}]);
  await q("insert into icash_deal_files values($1,$2,$3,'under_contract','{\"state\":\"TX\"}')",[id(n),id(account),id(n+1000)]);
  await q("insert into icash_signing_envelopes values($1,$2,'completed',false)",[id(n+2000),id(account)]);
  await q("insert into icash_disposition_authorities values($1,$2,$3,now()+interval '1 day',$4)",[id(n),id(account),market,id(n+2000)]);
 };
 for(const n of [10,11])await deal(n);
 await deal(12,1,'Legacy');await deal(13,1,'Missing property');await deal(14,2);await deal(15,1,'Eligibility');
 for(const n of [100,101,102])await q("insert into icash_title_directory(id,domain,name,source_url,public_email,claimed_states,contact_checked_until) values($1,$2,'Office','https://example.invalid/office','office@example.invalid',array['TX'],now()+interval '1 day')",[id(n),'office-'+n+'.invalid']);
 await q("update icash_title_directory set status='qualified',qualification_evidence='fixture:verified-office',verified_states=array['TX'],verified_until=now()+interval '1 day' where id=$1",[id(101)]);
 await q("insert into icash_title_qualification_jobs(id,account_id,company_id,market,state_code,state,provider_id) values($1,$2,$3,'Legacy','TX','needs_review','original-unknown-receipt')",[id(900),id(1),id(101)]);
 await q("insert into icash_operation_spend values($1,'dispatched')",['title-qualify:'+id(900)]);
 await db.exec(patch);
 const queue=(a,d)=>val('select icash_queue_title_qualification($1,$2)',[id(a),id(d)]);
 const origins=()=>q('select * from icash_learning_private.title_qualification_origins order by job_id');
 const count=()=>val('select count(*)::int from icash_title_qualification_jobs');
 assert.equal((await origins()).rows.length,0,'Installing must not infer origins for historical work');
 for(const table of ['title_qualification_origins','title_qualification_reuses']){
  const name='icash_learning_private.'+table;
  assert.equal(await val("select has_table_privilege('service_role',$1,'select')",[name]),true);
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['insert','update','delete','truncate'])assert.equal(await val('select has_table_privilege($1,$2,$3)',[role,name,privilege]),false);
  for(const role of ['anon','authenticated'])assert.equal(await val("select has_table_privilege($1,$2,'select')",[role,name]),false);
  assert.equal(await val('select relrowsecurity from pg_class where oid=$1::regclass',[name]),true);
 }
 for(const role of ['anon','authenticated'])assert.equal(await val("select has_function_privilege($1,'icash_queue_title_qualification(uuid,uuid)','execute')",[role]),false);
 // The only writer is the existing, service-only queue. It still selects two
 // offices, qualified first, from current state coverage and checked contacts.
 await db.exec('set role service_role');await queue(1,10);
 assert.equal(await val('select count(*)::int from icash_learning_private.title_qualification_origins'),2);
 await assert.rejects(db.exec('delete from icash_learning_private.title_qualification_origins'),/permission denied/);
 await db.exec('reset role');
 assert.equal(await count(),3);
 const first=(await origins()).rows;
 assert(first.every(o=>o.account_id===id(1)&&o.deal_id===id(10)&&o.screening_id===id(1010)&&o.property_id==='property-10'));
 assert.deepEqual((await q('select company_id from icash_title_qualification_jobs where market=$1 order by company_id',['Dallas'])).rows.map(r=>r.company_id),[id(100),id(101)]);
 await queue(1,10);assert.equal(await count(),3);
 assert.equal(await val('select count(*)::int from icash_learning_private.title_qualification_reuses'),0,'Repeated origin is not a separate reuse');
 await queue(1,11);
 const reuse=(await q('select * from icash_learning_private.title_qualification_reuses order by job_id')).rows;
 assert.equal(reuse.length,2);assert(reuse.every(r=>r.deal_id===id(11)&&r.property_id==='property-11'));
 await queue(1,11);assert.deepEqual((await q('select * from icash_learning_private.title_qualification_reuses order by job_id')).rows,reuse,'Repeated reuse preserves original timestamp and identity');
 assert.deepEqual((await origins()).rows,first,'Shared reuse never changes the original cost owner');
 await q("update icash_screening_jobs set snapshot='{\"propertyId\":\"changed-later\"}' where id=$1",[id(1010)]);
 await queue(1,10);assert.deepEqual((await origins()).rows,first,'Later source edits do not rewrite recorded property evidence');
 await assert.rejects(q('update icash_learning_private.title_qualification_origins set deal_id=$1',[id(11)]),/immutable/);
 await assert.rejects(q('delete from icash_learning_private.title_qualification_reuses'),/immutable/);
 await queue(1,12);
 assert.equal(await val('select count(*)::int from icash_learning_private.title_qualification_origins where job_id=$1',[id(900)]),0,'Legacy job remains unattributed even when reused');
 assert.equal(await val('select deal_id from icash_learning_private.title_qualification_reuses where job_id=$1',[id(900)]),id(12));
 assert.deepEqual((await q('select state,provider_id from icash_title_qualification_jobs where id=$1',[id(900)])).rows[0],{state:'needs_review',provider_id:'original-unknown-receipt'});
 assert.deepEqual((await q('select * from icash_operation_spend')).rows,[{operation_key:'title-qualify:'+id(900),state:'dispatched'}],'No new billing, zero settlement or unknown-operation replay');
 await q('update icash_deal_files set screening_id=$1 where id=$2',[id(1014),id(13)]);
 await queue(1,13);
 assert.equal(await val('select count(*)::int from icash_learning_private.title_qualification_origins where deal_id=$1 and screening_id is null and property_id is null',[id(13)]),2,'Foreign property evidence cannot become a cost binding; operational queue still works');
 await queue(2,14);assert.equal(await val('select count(*)::int from icash_learning_private.title_qualification_origins where deal_id=$1 and account_id=$2',[id(14),id(2)]),2);
 const before=await count();await queue(1,14);assert.equal(await count(),before,'Cross-account deal is not admitted');
 const held=async(mutate,restore)=>{await db.exec(mutate);await queue(1,15);assert.equal(await count(),before);await db.exec(restore);};
 await held(`update icash_deal_files set stage='closed' where id='${id(15)}'`,`update icash_deal_files set stage='under_contract' where id='${id(15)}'`);
 await held(`update icash_disposition_authorities set expires_at=now()-interval '1 second' where deal_id='${id(15)}'`,`update icash_disposition_authorities set expires_at=now()+interval '1 day' where deal_id='${id(15)}'`);
 await held(`update icash_signing_envelopes set test_mode=true where id='${id(2015)}'`,`update icash_signing_envelopes set test_mode=false where id='${id(2015)}'`);
 await held(`update icash_signing_envelopes set state='sent' where id='${id(2015)}'`,`update icash_signing_envelopes set state='completed' where id='${id(2015)}'`);
 await held(`update icash_deal_files set terms='{ "state":"invalid" }' where id='${id(15)}'`,`update icash_deal_files set terms='{ "state":"TX" }' where id='${id(15)}'`);
 await held(`update icash_disposition_authorities set market=repeat('x',121) where deal_id='${id(15)}'`,`update icash_disposition_authorities set market='Eligibility' where deal_id='${id(15)}'`);
 await held(`insert into icash_title_contacts values('${id(15)}','${id(1)}',true,now()+interval '1 day')`,`delete from icash_title_contacts`);
 await held(`update icash_title_directory set contact_checked_until=now()-interval '1 second'`,`update icash_title_directory set contact_checked_until=now()+interval '1 day'`);
 await queue(1,15);assert.equal(await count(),before+2,'Restored original eligibility still queues its bounded work');
 console.log('Title outcome attribution: real SQL source guard, original eligibility, immutable first owner/reuse, missing property, historical ambiguity and service-only grants passed. No paid work performed.');
}finally{await db.close();}
