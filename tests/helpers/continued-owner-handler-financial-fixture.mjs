import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installContinuedHandlerFinancialRelations} from './continued-owner-handler-financial-relations.mjs';
const read=name=>JSON.parse(readFileSync(new URL('../fixtures/'+name,import.meta.url),'utf8'));
export const financialFunctions=read('continued-owner-handler-financial-functions.json');
const relations=read('continued-owner-handler-financial-relations.json');
const value=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
const categories=['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'];

// Source-only production captures, synthetic rows, no external connection.
// Existing owner/source fixtures keep their tables and original guards. Missing
// relation shapes let the exact financial bodies compile; unrelated voice,
// seller and reception rows stay empty. The contact-target view is represented
// by an empty relation here; this fixture makes no voice-eligibility claim.
export async function installContinuedHandlerFinancialFixture(db){
 await installContinuedHandlerFinancialRelations(db,relations,financialFunctions);
 await db.exec(`alter table icash_private.provider_costs alter column operation_key set not null;
  alter table icash_private.provider_costs add constraint provider_costs_account_id_fkey foreign key(account_id) references public.icash_accounts(id)`);
 // Preserve captured bodies, including non-owner branches. Deferred validation
 // permits their unused cross-domain dependencies; every executed owner path
 // is tested below against the real function, not a replacement success stub.
 await db.exec('set check_function_bodies=off');
 try{for(const entry of financialFunctions){
  await db.exec(entry.definition);
  assert.equal(await value(db,'select md5(pg_get_functiondef($1::regprocedure))',[entry.signature]),entry.md5,entry.signature);
 }}finally{await db.exec('set check_function_bodies=on');}
 for(const [signature,hash] of [
  ['public.icash_guard_owner_enrichment_recovery_credit()','da7b5e7462a600733eab219ddcb69437'],
  ['public.icash_guard_owner_enrichment_recovery_spend()','7416b7135754d4973db2144b155d00fe']
 ])assert.equal(await value(db,'select md5(pg_get_functiondef($1::regprocedure))',[signature]),hash,'Existing recovery guard preserved');
 await db.exec(`create trigger icash_prospecting_spend_guard before insert on public.icash_operation_spend for each row execute function public.icash_guard_prospecting_spend();
  insert into public.icash_acquisition_policy(id,mode) values(1,'hybrid') on conflict(id) do nothing;
  insert into public.icash_voice_capacity_policy(id,workspace_limit,verified_at,source,credit_state) values(1,1,now(),'SYNTHETIC owner fixture: no voice work','exhausted') on conflict(id) do nothing;
  insert into icash_work_private.value_priority_settings(id,enabled) values(true,true) on conflict(id) do nothing;
  update public.icash_operating_budget set enabled=true,require_company_reserve=false,standard_cost_multiplier=2,elevenlabs_cost_multiplier=2;
  insert into public.icash_data_cost_settings(provider,credit_micros,cost_basis,source_ref) values('dealmachine',10000,'estimated','SYNTHETIC owner financial fixture') on conflict(provider) do nothing;`);
 for(const entry of financialFunctions){
  await db.exec(`revoke all on function ${entry.signature} from public,anon,authenticated;grant execute on function ${entry.signature} to service_role`);
 }
 await db.exec('grant usage on schema icash_reliability_private,icash_recorded_reception_private to service_role;grant select on all tables in schema icash_reliability_private,icash_recorded_reception_private to service_role;grant select,insert,update on all tables in schema public to service_role;grant usage,select on all sequences in schema public to service_role');
}

export async function seedContinuedHandlerFinancial(db,c){
 const rates=(await db.query('select r.id,r.costs_micros from public.icash_operation_rates r join public.icash_discovery_configs d on d.contact_rate_id=r.id where d.account_id=$1',[c.account])).rows;
 for(const rate of rates){
  const costs=Object.fromEntries(categories.map(name=>[name,rate.costs_micros[name]??0]));
  await db.query('update public.icash_operation_rates set costs_micros=$1 where id=$2',[JSON.stringify(costs),rate.id]);
 }
 await db.query("update public.icash_accounts set billing_model='membership_credits' where id=$1",[c.account]);
 await db.query("insert into public.icash_memberships(mode,guest_hash,account_id,state,price_cents,offer_revision,consent_version,consent_text,paid_through) values('live',repeat('a',64),$1,'active',5000,1,'SYNTHETIC','SYNTHETIC local fixture',now()+interval '1 day')",[c.account]);
 await db.query("insert into public.icash_funding_orders(mode,guest_hash,account_id,pack_code,price_cents,credit_cents,state,credited_at) values('live',repeat('b',64),$1,'SYNTHETIC',10000,10000,'paid',now())",[c.account]);
 await db.query('insert into public.icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,10000) on conflict(account_id) do update set enabled=true',[c.account]);
 await db.query("insert into public.icash_prospecting_budgets(account_id,funding_event,baseline_cents) values($1::uuid,'SYNTHETIC owner fixture:'||($1::uuid)::text,10000) on conflict(funding_event) do nothing",[c.account]);
 assert.equal(await value(db,'select public.icash_membership_work_allowed($1)',[c.account]),true);
 assert.equal(await value(db,'select public.icash_research_purchase_allowed($1,$2,$3)',[c.account,'owners:'+c.account+':'+c.screening,rates[0].id]),true);
}

// Real protected-outreach quote from a valid synthetic rate/config, so whole-
// cohort affordability tests need not replace the authoritative floor function.
export async function seedContinuedHandlerOutreachFloor(db,c){
 const costs=Object.fromEntries(categories.map(name=>[name,name==='elevenlabs'?4000000:0]));
 const rate=await value(db,`insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds)
  values('seller_call','required-audio-30d-speech-v1:synthetic-owner:'||$1::text,977,$2,2000,'SYNTHETIC local owner fixture',now()-interval '1 minute',now()+interval '1 day',true,600) returning id`,[c.account,JSON.stringify(costs)]);
 await db.query(`insert into public.icash_customer_identities(account_id,first_name,last_name,voice_id,voice_name)
  values($1,'Synthetic','Owner','fixture_voice','SYNTHETIC') on conflict(account_id) do nothing`,[c.account]);
 await db.query(`insert into public.icash_voice_configs(account_id,agent_id,phone_number_id,agent_config_hash,reviewed_until,seller_rate_id,required_tool_ids,enabled)
  values($1,'agent_fixture','SYNTHETIC',repeat('a',64),now()+interval '1 day',$2,array['tool_fixtureOne','tool_fixtureTwo'],true)`,[c.account,rate]);
 const floor=Number(await value(db,'select public.icash_prospecting_outreach_floor($1)',[c.account]));
 assert.equal(floor,192,'Actual two-minute protected outreach floor');
 return floor;
}

// A schema-valid orphan cost is possible because the live table has no
// operation-spend foreign key. It is separate from the canonical unresolved
// owner request (an admitted export plus dispatched spend without a receipt).
// No current application writer was found for this legacy private cost table.
export async function seedContinuedHandlerOrphanCost(db,c,screeningId=c.screening){
 const operation='owners:'+c.account+':'+screeningId;
 return value(db,`insert into icash_private.provider_costs(account_id,provider,provider_event_id,operation_key,cost_usd,occurred_at)
  values($1,'SYNTHETIC','synthetic-orphan:'||gen_random_uuid()::text,$2,0.01,clock_timestamp()) returning to_jsonb(provider_costs)`,[c.account,operation]);
}
