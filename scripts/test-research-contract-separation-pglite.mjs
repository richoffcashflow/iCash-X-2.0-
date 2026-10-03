/** SIMULATION ONLY. Actual SQL/services in ephemeral PostgreSQL; synthetic provider requests only. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {createJourneyDb,read} from '../tests/helpers/simulated-journey-db.mjs';
import {databaseAdapter,loadService} from '../tests/helpers/simulated-journey-services.mjs';
import {discoveryWorkEnabled,contactWorkEnabled,liveWorkReady} from '../lib/live-work-admission.ts';
import {discoverPage} from '../lib/discovery-pipeline.ts';
import {validateCostManifest} from '../lib/cost-manifest.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {signingReadiness,signingTermsHash} from '../lib/signing-policy.ts';
const {pg,notices}=await createJourneyDb(process.argv[2]);const {db,rpc,q}=databaseAdapter(pg);
const one=async(sql,args=[])=>{const {rows}=await q(sql,args);assert.equal(rows.length,1);return rows[0];};
const oldFetch=globalThis.fetch;let estimates=0,paid=0;
Object.assign(process.env,{ICASH_LIVE_WORK_READY:'true',DEALMACHINE_API_KEY:'dm_sk_live_SIMULATION_NO_NETWORK',DOCUSEAL_MODE:'live',DOCUSEAL_API_KEY:'SIMULATION_NO_NETWORK'});
try{
 // The rollout replaces only discovery provisioning. Reapplication is idempotent.
 const otherFunctionsSql="select md5(string_agg(pg_get_functiondef(p.oid), E'\\n' order by p.oid)) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'icash_%' and p.proname<>'icash_provision_before_voice_template'";
 const otherFunctionsBefore=(await one(otherFunctionsSql)).hash;
 const signingBefore=(await one("select md5(pg_get_functiondef('icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure)) hash")).hash;
 const voiceBefore=(await one("select md5(pg_get_functiondef('icash_provision_funded_account(uuid)'::regprocedure)) hash")).hash;
 await pg.exec(read('config/research-contract-separation.sql'));
 await pg.exec(read('config/research-contract-separation.sql'));
 assert.equal((await one(otherFunctionsSql)).hash,otherFunctionsBefore,'Every other icash function, including financial/contact/STOP/DNC gates, must stay identical');
 assert.equal((await one("select md5(pg_get_functiondef('icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure)) hash")).hash,signingBefore);
 assert.equal((await one("select md5(pg_get_functiondef('icash_provision_funded_account(uuid)'::regprocedure)) hash")).hash,voiceBefore);
 const user=randomUUID();await q("insert into auth.users(id,email,email_confirmed_at) values($1,'separation@example.invalid',now())",[user]);
 const account=await rpc('icash_create_account',{p_user:user});
 assert.equal((await rpc('icash_provision_funded_account',{p_account:account})).status,'funding_required');
 const order=(await one("insert into icash_funding_orders(mode,guest_hash,pack_code,price_cents,credit_cents) values('live',$1,'work',300,300) returning id",['f'.repeat(64)])).id;
 await rpc('icash_settle_funding',{p_order:order,p_mode:'live',p_session:'cs_live_SIMULATION_SEPARATION',p_payment:'pi_SIMULATION_SEPARATION',p_amount:300,p_email:'separation@example.invalid',p_phone:null});
 assert.equal(await rpc('icash_claim_funding',{p_user:user,p_mode:'live'}),account);
 const provision=await rpc('icash_provision_funded_account',{p_account:account});
 assert.equal(provision.status,'configured');assert.equal(provision.zip,'38118');assert.equal(provision.voice.status,'reviewed_template_required');
 assert.equal((await one('select bot_paused from icash_accounts where id=$1',[account])).bot_paused,true);
 assert.equal((await one('select count(*)::int n from icash_inventory_markets where account_id=$1',[account])).n,15);
 assert.equal((await one("select icash_market_contract_ready('38118',1) ready")).ready,false);
 assert.equal((await one('select count(*)::int n from icash_signing_templates')).n,0);
 // Existing operator holds, licensed-use deadline and selected ZIP are preserved.
 await q('begin');try{
  await q("update icash_discovery_configs set enabled=false,auto_enabled=false,contacts_enabled=false,data_rights_until=now()-interval '1 day',zip='35206' where account_id=$1",[account]);
  const before=await one('select * from icash_discovery_configs where account_id=$1',[account]);
  assert.equal((await rpc('icash_provision_funded_account',{p_account:account})).status,'configured');
  assert.deepEqual(await one('select * from icash_discovery_configs where account_id=$1',[account]),before);
  await q("update icash_discovery_configs set zip='00000' where account_id=$1",[account]);
  assert.equal((await rpc('icash_provision_funded_account',{p_account:account})).status,'market_configuration_required');
 }finally{await q('rollback');}
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'public.icash_provision_before_voice_template(uuid)','execute') exposed",[role])).exposed,false);
 await q('update icash_accounts set daily_limit_cents=300 where id=$1',[account]);
 await q('update icash_operating_budget set enabled=true,require_company_reserve=false');
 await q('insert into icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,300)',[account]);
 const costs=await loadService('lib/operating-costs.ts',{db,validateCostManifest,discoveryWorkEnabled,contactWorkEnabled,liveWorkReady});
 const market=await loadService('lib/contract-coverage-service.ts',{db});
 const discovery=await loadService('lib/discovery-service.ts',{db,discoveryWorkEnabled,liveWorkReady,dispatchReservedOperation:costs.dispatchReservedOperation,discoverPage,propertyResearchMarketKnown:market.propertyResearchMarketKnown});
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.v2.dealmachine.com/v1/properties/search');const body=JSON.parse(options.body);
  assert.equal(body.per_page,5);assert.equal(body.contact_audience,'none');assert.equal(body.anchor,'properties');
  if(body.estimate_cost){estimates++;return Response.json({estimated_credits:{this_page:5,breakdown:{people:0}}});}
  paid++;return Response.json({data:Array.from({length:5},(_,i)=>({dm_property_id:`prop_${20000+i}`,full_address:`${i+1} Fixture Lane, Memphis TN 38118`,state:'TN',zip:'38118',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000,estimated_equity_percentage:75})),credits:{used:5,people:0},pagination:{has_next_page:true}});
 };
 assert.equal((await discovery.discoverForAccount(account)).status,'paused');assert.equal(estimates,0);
 await rpc('icash_set_work_control',{p_user:user,p_account:account,p_action:'resume'});
 for(const [sql,error] of [
  ['update icash_wallets set balance_cents=83 where account_id=$1',/Insufficient credits/],
  ['update icash_accounts set daily_limit_cents=83 where id=$1',/Daily budget/],
  ['update icash_spend_activations set customer_cap_cents=83 where account_id=$1',/Activation spending cap/],
  ['update icash_spend_activations set enabled=false where account_id=$1',/activat/i],
 ]){await q('begin');try{await q(sql,[account]);await assert.rejects(()=>discovery.discoverForAccount(account),error);assert.equal(paid,0);}finally{await q('rollback');}}
 for(const [sql,status] of [
  ["update icash_discovery_configs set data_rights_until=now()-interval '1 day' where account_id=$1",'not_ready'],
  ["update icash_discovery_configs set zip='00000' where account_id=$1",'market_configuration_required'],
 ]){await q('begin');try{await q(sql,[account]);assert.equal((await discovery.discoverForAccount(account)).status,status);assert.equal(paid,0);}finally{await q('rollback');}}
 assert.equal((await discovery.discoverForAccount(account)).status,'screening_queued');assert.equal(paid,1);
 assert.equal((await one('select count(*)::int n from icash_screening_jobs where account_id=$1',[account])).n,5);
 assert.equal((await one('select charge_cap_cents::int amount from icash_operation_spend where account_id=$1',[account])).amount,84);
 for(const table of ['icash_owner_contacts','icash_contact_permissions','icash_voice_jobs','icash_signing_envelopes'])assert.equal((await one(`select count(*)::int n from ${table} where account_id=$1`,[account])).n,0,table);
 // A real TN deal cannot use a reviewed TX template through either service or raw SQL.
 const screen=(await one('select id from icash_screening_jobs where account_id=$1 limit 1',[account])).id;
 const terms=dealTermsSchema.parse({seller:'Fixture Seller',buyer:'Fixture Principal',address:'Fixture TN property',legalDescription:'Fixture legal description',state:'TN',priceCents:100000,priceSource:'seller_reported',earnestCents:0});
 const deal=(await one('insert into icash_deal_files(account_id,screening_id,terms) values($1,$2,$3) returning id',[account,screen,terms])).id;
 await q("insert into icash_customer_identities(account_id,first_name,last_name,voice_id,voice_name) values($1,'Fixture','Principal','fixture','Fixture')",[account]);
 const template=(await one("insert into icash_signing_templates(state_code,kind,signer_count,provider_template_id,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled,provider) values('TX','purchase',1,'123','[\"Seller\",\"Customer\"]','{}',now()+interval '1 day','SIMULATION ONLY',false,true,'docuseal') returning id")).id;
 const signing=await loadService('lib/signing-service.ts',{z,db,dealTermsSchema,signingReadiness});
 await assert.rejects(()=>signing.sendForSignatures({accountId:account,userId:user,customerEmail:'separation@example.invalid',dealId:deal,kind:'purchase',signers:[{name:'Fixture Seller',email:'seller@example.invalid'}]}),/active contract template/);
 await assert.rejects(()=>rpc('icash_begin_signing',{p_user:user,p_account:account,p_deal:deal,p_kind:'purchase',p_template:template,p_hash:signingTermsHash(terms),p_recipients:[{id:'1',email:'seller@example.invalid'},{id:'2',email:'separation@example.invalid'}]}),/query returned no rows/);
 assert.equal((await one('select count(*)::int n from icash_signing_envelopes')).n,0);assert.equal(paid,1);
 assert(!notices.some(n=>n.includes('Funded account provisioning deferred')));
 console.log('SIMULATED PASS: funded TN provision/discovery with live flag and no TN contracts; $0.84 atomic reservation; all 15 configured ZIPs only; pause/rights/funding/day/lifetime/activation/unknown-market holds; idempotent SQL and unchanged voice/signing definitions; no contact authority or voice jobs; TN service and SQL signing fail closed on TX template. No external requests.');
}finally{globalThis.fetch=oldFetch;await pg.close();}
