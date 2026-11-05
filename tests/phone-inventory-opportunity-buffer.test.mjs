import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const migration=read('config/phone-inventory-opportunity-buffer.sql');
const captured=JSON.parse(read('tests/fixtures/phone-inventory-buffer-before.json'));
const count=()=>one('select icash_pending_opportunity_count(fixture_phone_id(1000))');
const evidence=()=>one('select fixture_phone_evidence()');
const isolate=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
try{
 await pg.exec(read('tests/fixtures/opportunity-schema.sql'));
 await pg.exec(read('tests/fixtures/phone-inventory-buffer.sql'));
 for(const f of captured){await pg.exec(f.definition);assert.equal(await one('select md5(pg_get_functiondef($1::regprocedure))',[f.signature]),f.hash);}
 await pg.exec('revoke all on function icash_pending_opportunity_count(uuid) from public,anon,authenticated;grant execute on function icash_pending_opportunity_count(uuid),icash_operational_phone(text),icash_owner_preflight_empty(uuid,uuid,jsonb) to service_role;grant usage on schema public to service_role;grant select on all tables in schema public to service_role;');
 assert.equal(await count(),25,'Reproduce a full buffer with fourteen settled but occupied phone sets');
 const before=await evidence(),acl=await one("select proacl::text from pg_proc where oid='icash_pending_opportunity_count(uuid)'::regprocedure");
 await pg.exec(migration);
 const definition=await one("select pg_get_functiondef('icash_pending_opportunity_count(uuid)'::regprocedure)");
 assert.equal(definition.replace(migration.split('$new$')[1],migration.match(/needle:='([^']+)';/)[1]),captured.find(x=>x.signature==='icash_pending_opportunity_count(uuid)').definition);
 assert.equal(await count(),11,'Independent research fits again; original seven unknowns stay in buffer');
 assert.deepEqual(await evidence(),before,'Read projection changes no contact, claim, money, ticket, or permission');
 assert.equal(await one("select proacl::text from pg_proc where oid='icash_pending_opportunity_count(uuid)'::regprocedure"),acl);
 await pg.exec('set role service_role;begin read only');try{assert.equal(await count(),11);}finally{await pg.exec('rollback;reset role');}
 const cases=[
  "update icash_inventory_claims set cooldown_until=now() where screening_id=fixture_phone_id(1)",
  "update icash_inventory_claims set account_id=fixture_phone_id(1000) where screening_id=fixture_phone_id(1)",
  "delete from icash_inventory_claims where screening_id=fixture_phone_id(1)",
  "update icash_inventory_claims set resource_key='property:prop_1' where screening_id=fixture_phone_id(1)",
  "delete from icash_operational_contacts where screening_id=fixture_phone_id(1)",
  "update icash_operational_contacts set source_hash=repeat('0',64) where screening_id=fixture_phone_id(1)",
  "update icash_operational_contacts set account_id=fixture_phone_id(2000) where screening_id=fixture_phone_id(1)",
  "update icash_operational_contacts set eligibility_until=now() where screening_id=fixture_phone_id(1)",
  "update icash_operational_contacts set revoked_at=now() where screening_id=fixture_phone_id(1)",
  "update icash_operational_contacts set phone='+12145559999' where screening_id=fixture_phone_id(1)",
  "insert into icash_operational_contacts select account_id,screening_id,repeat('0',64),sending_principal,'sms','+12145559999',eligibility_until,null from icash_operational_contacts where screening_id=fixture_phone_id(1)",
  "update icash_owner_contacts set result=jsonb_set(result,'{propertyId}','\"prop_foreign\"') where screening_id=fixture_phone_id(1)",
  "update icash_owner_contacts set result=result||'{\"changed\":true}' where screening_id=fixture_phone_id(1)",
  "update icash_operation_spend set state='dispatched',settled_at=null where operation_key like '%:'||fixture_phone_id(1)",
  "update icash_operation_spend set settled_at=null where operation_key like '%:'||fixture_phone_id(1)",
  "update icash_operation_spend set account_id=fixture_phone_id(2000) where operation_key like '%:'||fixture_phone_id(1)",
  "insert into icash_contact_permissions values(fixture_phone_id(1000),fixture_phone_id(1),'+12145559999',now()+interval '1 hour',null)",
  "update icash_screening_jobs set snapshot=snapshot||'{\"sellerRequest\":true}' where id=fixture_phone_id(1)",
  "update icash_screening_jobs set state='queued' where id=fixture_phone_id(1)",
  "update icash_screening_jobs set state='running' where id=fixture_phone_id(1)",
 ];
 for(const sql of cases)await isolate(async()=>{await pg.exec(sql);assert.equal(await count(),12,sql);});
 for(const change of ["jsonb_set(result,'{requestedPersonIds}','[]')","jsonb_set(result,'{contacts,0,phones,0,number}','\"invalid\"')","jsonb_set(result,'{contacts,0,personId}','\"wrong\"')","jsonb_set(result,'{contacts,0,phones}',(result#>'{contacts,0,phones}')||'[{\"number\":\"+12145559999\",\"doNotCall\":false}]')",
  "jsonb_set(result,'{contacts,0,phones}',(result#>'{contacts,0,phones}')||'[null]')",
  "jsonb_set(result,'{contacts,0,phones}',(result#>'{contacts,0,phones}')||'[{}]')",
  "jsonb_set(result,'{contacts}',(result->'contacts')||'[{\"personId\":\"person_1\",\"likelyOwner\":true}]')",
  "jsonb_set(result,'{contacts}',(result->'contacts')||'[{\"personId\":\"person_1\",\"likelyOwner\":true,\"phones\":[]}]')"])
  await isolate(async()=>{await pg.exec(`update icash_owner_contacts set result=${change} where screening_id=fixture_phone_id(1);update icash_operational_contacts c set source_hash=encode(sha256(convert_to(o.result::text,'UTF8')),'hex') from icash_owner_contacts o where o.account_id=c.account_id and o.screening_id=c.screening_id;`);assert.equal(await count(),12,change);});
 await isolate(async()=>{await pg.exec("select fixture_phone_seed(26,'unknown');update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"prop_1\"') where id=fixture_phone_id(26)");assert.equal(await count(),13,'Same-property unknown retains both records');});
 for(const sql of ["delete from icash_customer_identities","update icash_customer_identities set principal=''","update icash_customer_identities set principal='Different Buyer';delete from icash_operational_contacts"])
  await isolate(async()=>{await pg.exec(sql);assert.equal(await count(),25,sql);});
 await isolate(async()=>{await pg.exec("insert into icash_contact_permissions values(fixture_phone_id(2000),fixture_phone_id(1),'+12145559999',now()+interval '1 hour',null)");assert.equal(await count(),11,'Foreign permission cannot change this account');});
 await isolate(async()=>{await pg.exec("insert into icash_contact_permissions values(fixture_phone_id(1000),fixture_phone_id(1),'+12145559999',now()-interval '1 hour',null)");assert.equal(await count(),11,'Expired legacy permission is not an alternative');});
 assert.deepEqual(await evidence(),before);
 assert.equal(await one("select provolatile::text||':'||prosecdef::text from pg_proc where oid='icash_pending_opportunity_count(uuid)'::regprocedure"),'s:false');
 assert.equal(migration,read('supabase/migrations/20261105024912_phone_inventory_opportunity_buffer.sql'));
 console.log('PASS phone-inventory buffer:25→11, original unknowns retained, alternate/unprepared phones and permissions preserved, exact source/tenant proof, current claims, unchanged records/ACL and read-only service call.');
}finally{await pg.close();}
