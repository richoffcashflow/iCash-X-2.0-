// Offline PostgreSQL only. Test the real quality validator against its read-only
// hint, then execute the actual projection SELECT with counted final checks.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import * as f from './helpers/list-quality-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const before=JSON.parse(read('tests/fixtures/scheduler-fast-selection-before.json'));
const sql=read('config/scheduler-fast-selection.sql');
const name=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_scheduler_fast_selection.sql'));
assert.equal(read('supabase/migrations/'+name),sql);
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await pg.exec('create role anon;create role authenticated;create role service_role;'+f.coreSetup+f.helpers+f.core+f.seed);
 await pg.exec(before.find(x=>x.proname==='icash_owner_sms_quality_current').definition);
 await pg.exec(sql.slice(sql.indexOf('create function public.icash_owner_sms_quality_candidate'),sql.indexOf('do $patch$')));
 const hint=(phone,a=f.account,s=f.screen)=>one('select icash_owner_sms_quality_candidate($1,$2,$3)',[a,s,phone]);
 const current=(phone,a=f.account,s=f.screen)=>one('select icash_owner_sms_quality_current($1,$2,$3)',[a,s,phone]);
 const choiceCount=()=>one('select count(*)::integer from icash_research_private.owner_sms_choices');
 assert.equal(await hint('+12145550101'),false,'Known landline is rejected early');
 assert.equal(await hint('+12145550102'),true,'Unknown original choice is left to final validation');
 assert.equal(await choiceCount(),0,'Hint never records a choice');
 assert.equal(await current('+12145550102'),false,'Final validator chooses the better mobile');
 assert.equal(await choiceCount(),1);
 assert.equal(await hint('+12145550102'),false,'Original different choice can be rejected');
 assert.equal(await hint('+12145550103'),true);
 assert.equal(await current('+12145550103'),true);
 assert.equal(await hint('+12145550103',f.other),true,'Missing account source is unknown, not admission');
 assert.equal(await current('+12145550103',f.other),false);
 await q("insert into icash_text_threads values($1,$2,'+12145550102','seller')",[id(90),f.account]);
 await q("insert into icash_text_messages values($1,$2,$3,'incoming','received',null,null,now())",[id(91),f.account,id(90)]);
 assert.equal(await hint('+12145550102'),false,'Unverified message is not a human exception');
 await q('update icash_text_messages set event_id=$1',[id(92)]);
 assert.equal(await hint('+12145550102'),true);assert.equal(await current('+12145550102'),true);
 await q('update icash_text_messages set account_id=$1',[f.other]);
 assert.equal(await hint('+12145550102'),false,'Foreign-account reply cannot bypass the choice');
 await pg.exec('delete from icash_text_messages;delete from icash_text_threads');
 // False hints must imply a false original predicate. A true hint is never
 // sufficient: DNC/source/routing/funding still run in the unchanged selector.
 for(const source of [f.source,{...f.source,requestedPersonIds:[]},{...f.source,contacts:[{...f.person,likelyOwner:false}]},
  {...f.source,contacts:[{...f.person,phones:f.person.phones.map(p=>({...p,doNotCall:true}))}]},
  {...f.source,contacts:[{...f.person,personId:'per_fresh'}],requestedPersonIds:['per_fresh']},
  {...f.source,contacts:[f.person,{...f.person,personId:'per_second'}],requestedPersonIds:['per_1','per_second']}]){
  await pg.exec('begin');await q('update icash_owner_contacts set result=$1',[source]);
  for(const phone of ['+12145550101','+12145550102','+12145550103','+12145550104']){
   const eligible=await hint(phone),actual=await current(phone);
   if(actual)assert.equal(eligible,true,'Hint must not reject a valid original outcome');
  }
  await pg.exec('rollback');
 }
 await pg.exec('begin;update icash_research_private.list_quality_settings set enabled=false');
 assert.equal(await hint('+12145550101'),true);assert.equal(await current('+12145550101'),true);await pg.exec('rollback');
 await pg.exec('begin');await q("update icash_owner_contacts set result='{\"contacts\":{}}'");
 assert.equal(await hint('+12145550103'),true,'Malformed evidence reaches original diagnostics');await pg.exec('rollback');
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_owner_sms_quality_candidate(uuid,uuid,text)','execute')",[role]),false);
 assert.equal(await one("select has_function_privilege('service_role','icash_owner_sms_quality_candidate(uuid,uuid,text)','execute')"),true);
 await pg.exec('begin read only');await hint('+12145550103');await pg.exec('rollback');

 await pg.exec(`create table icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,phone text,channel text,revoked_at timestamptz,eligibility_until timestamptz,dnc_receipt_id uuid);
 create table icash_dnc_verification_receipts(id uuid primary key,evidence_kind text);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid);
 alter table icash_text_threads add column deal_id uuid,add column retired_at timestamptz;
 create table validation_fixture(contact_id uuid,valid boolean,route boolean);
 create sequence full_checks;
 create function icash_operational_contact_current(a uuid,c uuid,ch text,h boolean) returns boolean language plpgsql as $$begin
  perform nextval('full_checks');
  return (select valid from validation_fixture where contact_id=c) and public.icash_owner_sms_quality_current(a,(select screening_id from public.icash_operational_contacts where id=c),(select phone from public.icash_operational_contacts where id=c));
 end$$;
 create function icash_business_conversation_sender(uuid,uuid,text) returns text language sql stable as $$select '+12145550100'::text$$;
 create function icash_prospect_sms_route_available(a uuid,s uuid,p text,se text) returns boolean language sql stable as $$select coalesce((select bool_and(route) from validation_fixture f join icash_operational_contacts c on c.id=f.contact_id where c.account_id=a and c.screening_id=s and c.phone=p),false)$$;`);
 await q('insert into icash_accounts values($1,false),($2,false)',[f.account,f.other]);
 for(let n=100;n<260;n++){
  const phone=n===259?'+12145550103':'+12145550101';
  await q("insert into icash_operational_contacts values($1,$2,$3,$4,'sms',null,now()+interval '1 day',$1)",[id(n),f.account,f.screen,phone]);
  await q("insert into icash_dnc_verification_receipts values($1,'national_provider_observation')",[id(n)]);
  await q('insert into validation_fixture values($1,true,true)',[id(n)]);
 }
 const def=before.find(x=>x.proname==='icash_project_operational_sms_contacts').definition;
 const original=def.slice(def.indexOf('with candidates'),def.indexOf('\n loop'));
 const old=sql.match(/original:=\$old\$([\s\S]*?)\$old\$/)[1];
 const replacement=sql.match(/replacement:=\$new\$([\s\S]*?)\$new\$/)[1];
 const improved=original.replace(old,replacement);
 const rows=async query=>(await q(query.replaceAll('p_account','null::uuid'))).rows;
 const checks=()=>one('select case when is_called then last_value else 0 end from full_checks');
 await pg.exec("select setval('full_checks',1,false)");const legacy=await rows(original),oldChecks=Number(await checks());
 await pg.exec("select setval('full_checks',1,false)");assert.deepEqual(await rows(improved),legacy);const newChecks=Number(await checks());
 assert.equal(legacy.length,1);assert(oldChecks>=160);assert.equal(newChecks,1,'Rejected contacts do not crowd out final validation');
 for(const change of ["update validation_fixture set valid=false","update validation_fixture set valid=null","update validation_fixture set route=false","update validation_fixture set route=null","update icash_accounts set bot_paused=true","update icash_operational_contacts set revoked_at=now()","update icash_operational_contacts set eligibility_until=now()-interval '1 second'","update icash_dnc_verification_receipts set evidence_kind='legacy_record'"]){
  await pg.exec('begin;'+change);assert.deepEqual(await rows(improved),await rows(original),change);await pg.exec('rollback');
 }
 console.log(`Scheduler fast selection: real quality-rule implication, account/human/unknown boundaries, read-only hint and private ACLs; full checks ${oldChecks}->${newChecks}, same selected rows and final gates.`);
}finally{await pg.close();}
