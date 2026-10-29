// Actual DNC ingestion and final SMS/voice eligibility, saved offline evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const f=await createOperationalContactFixture(fileURLToPath(import.meta.resolve('@electric-sql/pglite')));
const {pg,q,rpc,one,isolated,account,user,other,phone,screening,source,dnc,sourceResult}=f;
const op='owners:'+account+':'+screening,batch=randomUUID(),csv='Synthetic saved original CSV',sha=createHash('sha256').update(csv).digest('hex');
try{
 await q('delete from icash_dnc_verification_receipts where id=$1',[dnc]);await q('delete from icash_dnc_verification_sources where id=$1',[source]);
 await q("update icash_operation_spend set created_at=now()-interval '59 minutes',dispatched_at=now()-interval '58 minutes',settled_at=now()-interval '57 minutes' where operation_key=$1",[op]);
 const result={...sourceResult,creditsUsed:0,peopleCredits:0,providerCredits:{used:1,people:1},requestedPersonIds:['per_101'],
  contacts:[{personId:'per_101',name:'Synthetic Owner',likelyOwner:true,ownershipVerified:false,outreachAuthorized:false,phones:[{number:phone.slice(-10),type:'Wireless',doNotCall:false,permission:'unverified',activity:'active',activityBasis:'provider_export_filter'}],emails:[]}],
  allocation:{batchId:batch,method:'active-export-used-order-v1',sharedContacts:1},activityEvidence:{contract:'owner-active-export-v1',exportId:'export-fixture',artifactSha256:sha}};
 await q("update icash_owner_contacts set result=$2,created_at=now()-interval '56 minutes' where screening_id=$1",[screening,result]);
 await q("insert into icash_cost_observations(provider,event_key,source_ref,amount,units,observed_at) values('dealmachine',$1,'dealmachine:owners:'||$1,0,'provider_credits',now()-interval '57 minutes')",[op]);
 await pg.exec(read('config/dealmachine-dnc-observations.sql'));
 await pg.exec(`create schema icash_research_private;
 create table icash_research_private.owner_batches(id uuid primary key,account_id uuid,primary_screening uuid,created_at timestamptz,state text,items jsonb,preview_receipt jsonb,paid_receipt jsonb,results jsonb);
 create table icash_research_private.owner_batch_items(screening_id uuid primary key,batch_id uuid,operation_key text unique);
 revoke all on schema icash_research_private from public,anon,authenticated,service_role;
 revoke all on all tables in schema icash_research_private from public,anon,authenticated,service_role;`);
 for(const d of JSON.parse(read('tests/fixtures/owner-export-before.json')))await pg.exec(d.definition);
 for(const d of JSON.parse(read('tests/fixtures/owner-export-dnc-before.json')))await pg.exec(d.definition);
 await pg.exec(read('config/owner-active-export.sql'));
 await pg.exec(read('config/owner-active-export-sources.sql'));
 const raw={export_id:'export-fixture',record_count:1,file_count:1,credits:{used:1,people:1}};
 await q("insert into icash_research_private.owner_batches values($1,$2,$3,now()-interval '1 hour','complete',$4,'{}',$5,$6)",[batch,account,screening,[{screeningId:screening,snapshot:{propertyId:result.propertyId},ids:['per_101']}],raw,[{screeningId:screening,result}]]);
 await q('insert into icash_research_private.owner_batch_items values($1,$2,$3)',[screening,batch,op]);
 await q("insert into icash_research_private.owner_exports(id,request,receipt,csv,artifact_sha256,terminal_at,completed_at) values($1,$2,$3,$4,$5,now()-interval '57 minutes',now()-interval '56 minutes')",[batch,{people_ids:['per_101'],active_phones_only:true,scrub_dnc:true,property_match:'owner'},{httpStatus:200,raw,rawText:JSON.stringify(raw)},csv,sha]);
 await q("update icash_dnc_verification_sources set enabled=true,expires_at=now()+interval '1 day' where observation_provider='dealmachine'");
 const wallet=(await one('select to_jsonb(w) value from icash_wallets w where account_id=$1',[account])).value;
 assert(await rpc('icash_dealmachine_credit_manifest_hash',{p_operation:op}));
 const ingest=()=>rpc('icash_ingest_dealmachine_dnc_observations',{p_account:account,p_user:user,p_screening:screening});
 assert.equal((await ingest()).observations,1,'Shared export owner proceeds with allocated zero and unmodified aggregate used=1');
 assert.equal((await ingest()).status,'already_recorded');
 await isolated(async()=>{await q('update icash_accounts set bot_paused=true where id=$1',[account]);assert.equal(await rpc('icash_prepare_operational_contacts',{p_account:account}),0);});
 assert.equal(await rpc('icash_prepare_operational_contacts',{p_account:account}),2,'Both voice and SMS use the original export source');
 assert.equal((await one('select count(*)::int n from icash_cost_observations where event_key like $1',[op+'%'])).n,1,'No fabricated lookup credit fields');
 const target=(await one("select id from icash_operational_contacts where account_id=$1 and channel='sms'",[account])).id;
 assert.equal(await rpc('icash_lock_operational_dnc',{p_account:account,p_contact:target}),true);
 for(const [sql,args] of [
  ['update icash_cost_observations set amount=1 where event_key=$1',[op]],
  ["update icash_research_private.owner_batches set state='claimed' where id=$1",[batch]],
  ['update icash_research_private.owner_batches set account_id=$2 where id=$1',[batch,other]],
 ])await isolated(async()=>{await q(sql,args);assert.equal(await rpc('icash_lock_operational_dnc',{p_account:account,p_contact:target}),false,sql);});
 await isolated(async()=>{await q("update icash_dnc_verification_receipts set revoked_at=now() where evidence_kind='national_provider_observation'");assert.equal(await rpc('icash_operational_contact_current',{p_account:account,p_contact:target,p_channel:'sms',p_check_hour:false}),false);});
 assert.deepEqual((await one('select to_jsonb(w) value from icash_wallets w where account_id=$1',[account])).value,wallet);
 console.log('Export contact handoff: actual DNC ingestion, shared-owner zero allocation, unchanged raw aggregate credits, both SMS/voice targets, final receipt/tenant/cost/revocation/Pause holds and no wallet mutation passed.');
}finally{await pg.close();}
