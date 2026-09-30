// Isolated PostgreSQL test. No credentials, network or production writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {settleBoundVoiceUsage} from '../lib/voice-usage-service.ts';
import {voiceCostManifest} from '../lib/voice-cost-settlement.ts';
import {costCategories} from '../lib/cost-guard.ts';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const table=(p,n)=>{const s=read(p);const start=s.indexOf('create table public.'+n+' (');assert(start>=0,n);return s.slice(start,s.indexOf(';',start)+1);};
const fn=(p,n)=>{const s=read(p);const start=s.indexOf('create function public.'+n+'(');assert(start>=0,n);return s.slice(start,s.indexOf('$$;',start)+3);};
const foundation='supabase/migrations/20260928015041_icash_accounts_deals_credit_foundation.sql';
const costs='supabase/migrations/20260928195902_atomic_operating_costs.sql';
try{
 await pg.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);');
 for(const n of ['icash_accounts','icash_wallets','icash_credit_ledger','icash_credit_reservations'])await pg.exec(table(foundation,n));
 for(const n of ['icash_operating_budget','icash_operation_rates','icash_operation_spend','icash_cost_observations'])await pg.exec(table(costs,n));
 await pg.exec(`alter table public.icash_operation_spend add standard_cost_multiplier numeric default 5,add elevenlabs_cost_multiplier numeric default 2,add cost_basis text default 'unreconciled';
 create table public.icash_live_conversations(operation_key text,account_id uuid,conversation_id text,state text,completed_at timestamptz,result jsonb,id text,created_at timestamptz default now());
 insert into public.icash_operating_budget(id,enabled,funded_micros,reserved_micros) values(1,true,100000000,0);`);
 await pg.exec(fn('supabase/migrations/20260928015153_icash_atomic_credits_and_engine_evidence.sql','icash_finish_credit'));
 await pg.exec(fn(costs,'icash_settle_operation'));
 await pg.exec(table('config/fulfillment-completion.sql','icash_cost_manifests'));
 await pg.exec(fn('config/fulfillment-completion.sql','icash_settle_complete_costs'));
 await pg.exec(read('config/voice-usage-settlement.sql'));
 const q=(sql,args)=>pg.query(sql,args);
 const account=(await q("insert into auth.users values(gen_random_uuid()) returning id")).rows[0].id;
 await q("insert into public.icash_accounts(id,owner_user_id,assistant_name) values($1,$1,'fixture')",[account]);
 await q('insert into public.icash_wallets values($1,10000,0,\'USD\')',[account]);
 async function operation(key,cap=1000,duration=3){
  const rate=(await q("insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at) values('seller_call',$1,$2,'{}','isolated fixture',now(),now()+interval '1 day') returning id",[key,cap])).rows[0].id;
  const cr=(await q('insert into public.icash_credit_reservations(account_id,operation_key,amount_cents) values($1,$2,$3) returning id',[account,key,cap])).rows[0].id;
  await q("insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until) values($1,$2,$3,$4,$5,1000000,'dispatched',now()+interval '1 day')",[key,account,rate,cr,cap]);
  await q('update public.icash_wallets set reserved_cents=reserved_cents+$1 where account_id=$2',[cap,account]);
  await q('update public.icash_operating_budget set reserved_micros=reserved_micros+1000000');
  await q("insert into public.icash_live_conversations(operation_key,account_id,conversation_id,state,completed_at,result,id) values($1,$2,$1,'complete',now(),$3,$1)",[key,account,JSON.stringify({durationSeconds:duration})]);
  await q("insert into public.icash_cost_observations(provider,event_key,source_ref,amount,units) values('elevenlabs',$1,$1,0.01,'USD')",[key]);
 }
 const inputs=Object.fromEntries(costCategories.map(k=>[k,{kind:'receipt',amountMicros:k==='elevenlabs'?10000:0,evidenceRef:'isolated receipt fixture'}]));
 inputs.twilio={kind:'duration_estimate',durationSeconds:3,unitSeconds:60,microsPerUnit:14000,rounding:'up',minimumUnits:0,evidenceRef:'isolated supplier rule',durationEvidenceRef:'isolated carrier duration'};
 inputs.support_and_overhead={kind:'fixed_estimate',amountMicros:1000,evidenceRef:'isolated fixed allocation'};
 const parts=voiceCostManifest(inputs).components;
 const settle=(k,p=parts)=>q('select public.icash_settle_voice_usage($1,$2,$3) as ok',[k,JSON.stringify(p),'isolated usage evidence']);
 await operation('short');assert.equal((await q("select public.icash_settle_estimated_operation('short') as ok")).rows[0].ok,false);
 assert.equal((await settle('short')).rows[0].ok,true);
 assert.equal((await q("select charged_cents::int as n from public.icash_operation_spend where operation_key='short'")).rows[0].n,10);
 await settle('short');assert.equal((await q('select count(*)::int as n from public.icash_credit_ledger')).rows[0].n,1);
 assert.equal((await q('select reserved_cents::int as n from public.icash_wallets')).rows[0].n,0);
 assert.equal((await q("select cost_basis from public.icash_operation_spend where operation_key='short'")).rows[0].cost_basis,'estimated');
 const changed=structuredClone(parts);changed.twilio.amountMicros=1000;await assert.rejects(settle('short',changed),/conflict/);
 await operation('missing',1000,null);assert.equal((await settle('missing')).rows[0].ok,false);
 await operation('ceiling',1);assert.equal((await settle('ceiling')).rows[0].ok,false);
 await operation('receipt');await q("delete from public.icash_cost_observations where event_key='receipt'");assert.equal((await settle('receipt')).rows[0].ok,false);
 await operation('wrong-receipt');const wrong=structuredClone(parts);wrong.elevenlabs.amountMicros=1;await assert.rejects(settle('wrong-receipt',wrong),/mismatch/);
 inputs.twilio.durationSeconds=600;await operation('long',1000,600);assert.equal((await settle('long',voiceCostManifest(inputs).components)).rows[0].ok,true);
 assert.equal((await q("select charged_cents::int as n from public.icash_operation_spend where operation_key='long'")).rows[0].n,73);
 // Exercise the actual server collector -> manifest -> real RPC -> real ledger boundary.
 const policy={enabled:true,version:'isolated-policy-v1',rateId:'',operation:'seller_call',reviewedAt:'2020-01-01',validFrom:'2020-01-01',validUntil:'2099-01-01',evidenceRef:'isolated reviewed evidence',components:Object.fromEntries(costCategories.filter(k=>k!=='elevenlabs').map(k=>[k,k==='twilio'?{kind:'duration_estimate',unitSeconds:60,microsPerUnit:14000,rounding:'up',minimumUnits:0,evidenceRef:'isolated supplier rule',durationSource:'conversation_proxy',assumption:'isolated reviewed proxy omits carrier ringing'}:{kind:'fixed_estimate',amountMicros:k==='support_and_overhead'?1000:0,evidenceRef:'isolated fixed allocation'}]))};
 const serviceDb=async(path,method,body)=>{
  if(method==='POST'){assert.equal(path,'rpc/icash_settle_voice_usage');return (await q('select public.icash_settle_voice_usage($1,$2,$3) as ok',[body.p_operation,JSON.stringify(body.p_components),body.p_evidence])).rows[0].ok;}
  const [table,query]=path.split('?');assert(['icash_live_conversations','icash_operation_spend','icash_operation_rates','icash_cost_observations'].includes(table));
  const params=new URLSearchParams(query);const filters=[];const values=[];
  for(const [key,value] of params){if(key==='select')continue;assert(/^[a-z_]+$/.test(key));assert(value.startsWith('eq.'));values.push(value.slice(3));filters.push(key+'=$'+values.length);}
  return (await q('select * from public.'+table+' where '+filters.join(' and '),values)).rows;
 };
 await operation('integrated');policy.rateId=(await q("select rate_id from public.icash_operation_spend where operation_key='integrated'")).rows[0].rate_id;
 const before=(await q('select count(*)::int n from public.icash_credit_ledger')).rows[0].n;
 assert.equal((await settleBoundVoiceUsage(serviceDb,account,'integrated',[policy])).status,'settled');
 assert.equal((await settleBoundVoiceUsage(serviceDb,account,'integrated',[policy])).status,'settled');
 assert.equal((await q('select count(*)::int n from public.icash_credit_ledger')).rows[0].n,before+1);
 assert.equal((await q("select charged_cents::int n from public.icash_operation_spend where operation_key='integrated'")).rows[0].n,10);
 const changedPolicy=structuredClone(policy);changedPolicy.components.support_and_overhead.amountMicros=2000;
 await assert.rejects(settleBoundVoiceUsage(serviceDb,account,'integrated',[changedPolicy]),/conflict/);
 console.log('PASS: completed bound conversation + observation -> server collector -> real RPC -> one debit; changed-policy retry conflicts');
 console.log('PASS: real ledger/manifest, 3s vs 600s, no-duration/receipt holds, quote ceiling, one debit, release reserve, immutable reconciliation conflict, honest basis');
 console.log('LIMITS: isolated base ledger; current fractional/account-margin wrappers and multi-session races not exercised');
}finally{await pg.close();}
