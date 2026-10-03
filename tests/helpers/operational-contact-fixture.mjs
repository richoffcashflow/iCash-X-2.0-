// SIMULATION ONLY. Shared isolated SQL fixture; never connects to production.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createJourneyDb} from './simulated-journey-db.mjs';
import {databaseAdapter} from './simulated-journey-services.mjs';
export async function createOperationalContactFixture(modulePath){
 const {pg}=await createJourneyDb(modulePath);
 const {q,rpc}=databaseAdapter(pg);
 const one=async(sql,args=[])=>{const result=await q(sql,args);assert.equal(result.rows.length,1,sql);return result.rows[0];};
 const apply=name=>pg.exec(readFileSync(new URL('../../config/'+name+'.sql',import.meta.url),'utf8'));
 const isolated=async action=>{await q('begin');try{return await action();}finally{await q('rollback');}};
 try{
 for(const name of ['text-ai','market-expansion','seller-opener-experiments','seller-opener-delivery-order','seller-workflow-continuity',
  'reply-signals','manual-handoff-replies','sms-inbound-campaign','sms-contact-intake','sms-manual-reply-continuity',
  'sms-opener-unstarted-recovery','sms-seller-opening','operational-contact-eligibility','operational-sms-eligibility'])await apply(name);
 const user=randomUUID(),account=randomUUID(),otherUser=randomUUID(),other=randomUUID(),newOwner=randomUUID();
 const phone='+12145550123',sender='+14243948384',called='+17816093521',hash='a'.repeat(64);
 await q('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)',[user,'operational-sms@example.invalid',otherUser,'other@example.invalid',newOwner,'new-owner@example.invalid']);
 await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values($1,$2,'Fixture',false,100000),($3,$4,'Other Fixture',false,100000)",[account,user,other,otherUser]);
 await q("insert into icash_wallets(account_id,balance_cents,reserved_cents,currency) values($1,100000,0,'USD'),($2,100000,0,'USD')",[account,other]);
 await q("insert into icash_customer_identities(account_id,first_name,last_name,company_name,voice_id,voice_name) values($1,'SIMULATION','Owner','SIMULATION business','fixture_voice','Fixture')",[account]);
 await rpc('icash_record_sms_inbound_campaign',{p_account:account,p_user:user,p_version:'sms-inbound-2026-09-30.1',p_accepted:true});
 await q("update icash_outreach_campaigns set enabled=true,reviewed_principal='SIMULATION business' where account_id=$1",[account]);
 const costs={dealmachine:0,elevenlabs:0,twilio:0,messaging:1000,email:0,llm:0,vercel:0,railway:0,supabase:0,github:0,payments:0,title_and_signing:0,support_and_overhead:0,acquisition:0,refund_and_dispute_reserve:0,other:0};
 const rate=async(operation,cost=costs)=>(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values($1,$2,100,$3,'SIMULATION complete cost quote',now()-interval '1 minute',now()+interval '1 day',true,600) returning id",[operation,randomUUID(),cost])).id;
 const sms=await rate('sms_send'),owners=await rate('owner_enrichment'),incoming=await rate('incoming_call',{...costs,messaging:0,elevenlabs:100000});
 await q("update icash_operating_budget set enabled=true,funded_micros=1000000000,protected_micros=0,reserved_micros=0,spent_micros=0,daily_limit_micros=null where id=1");
 const timezone=(await one("select name from pg_timezone_names where extract(hour from now() at time zone name)=12 limit 1")).name;
 const screening=(await one("insert into icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at) values($1,'SIMULATION operational SMS','{\"propertyId\":\"prop_1001\"}','complete','{\"financialCheck\":{\"status\":\"eligible\"}}',now()) returning id",[account])).id;
 const deal=(await one("insert into icash_deal_files(account_id,screening_id,stage,terms) values($1,$2,'draft','{\"address\":\"123 Main Street\",\"seller\":\"Record Owner\",\"practice\":false,\"state\":\"TX\"}') returning id",[account,screening])).id;
 await q("insert into icash_discovery_configs(account_id,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,contacts_enabled) values($1,'75201',$2,1000,now()+interval '1 day',0,true)",[account,owners]);
 const operation='owners:'+account+':'+screening;
 const reservation=(await one("insert into icash_credit_reservations(account_id,operation_key,amount_cents,status,settled_cents) values($1,$2,100,'settled',100) returning id",[account,operation])).id;
 await q("insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until,charged_cents,actual_micros,settled_at) values($1,$2,$3,$4,100,1000,'settled',now()+interval '1 day',100,1000,now())",[operation,account,owners,reservation]);
 const sourceResult={propertyId:'prop_1001',creditsUsed:1,peopleCredits:1,providerCredits:{used:1,people:1,properties:0,deduplicated:0},requestedPersonIds:['per_fixture'],outreachAuthorized:false,fetchedAt:new Date().toISOString(),contacts:[{personId:'per_fixture',likelyOwner:true,ownershipVerified:false,outreachAuthorized:false,phones:[{number:phone,doNotCall:false,permission:'unverified'}]}]};
 await q('insert into icash_owner_contacts(account_id,screening_id,operation_key,result) values($1,$2,$3,$4)',[account,screening,operation,sourceResult]);
 const source=(await one("insert into icash_dnc_verification_sources(name,source_reference,enabled,expires_at) values('SIMULATION DNC','SIMULATION actual source reference',true,now()+interval '1 day') returning id")).id;
 const dnc=(await one("insert into icash_dnc_verification_receipts(source_id,phone,contact_key,provider_reference,receipt_hash,checked_at,expires_at,clear,contact_timezone,timezone_source_reference) values($1,$2,encode(sha256(convert_to($2,'UTF8')),'hex'),'SIMULATION source receipt',$3,now()-interval '1 minute',now()+interval '1 day',true,$4,'SIMULATION source-record timezone') returning id",[source,phone,hash,timezone])).id;
 const prepare=()=>rpc('icash_prepare_operational_contacts',{p_account:account});
 const project=()=>rpc('icash_project_operational_sms_contacts',{p_account:account});
 return {pg,q,rpc,one,isolated,account,user,otherUser,other,newOwner,phone,sender,called,hash,sms,owners,incoming,timezone,screening,deal,sourceResult,source,dnc,prepare,project};
 }catch(error){await pg.close();throw error;}
}
