import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const migration=read('config/missing-receipt-settlement-yield.sql');
export const signature='public.icash_settle_estimate_before_sms_tokens(text)';
export const predecessor=JSON.parse(read('tests/fixtures/acquisition-settlement-isolation-before.json')).find(x=>x.signature===signature).definition;
export const wrappers=JSON.parse(read('tests/fixtures/missing-receipt-settlement-wrappers.json'));
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const setup=read('tests/fixtures/account-work-repair.sql')+'\n'+predecessor+`;
revoke all on function ${signature} from public,anon,authenticated;
grant execute on function ${signature} to service_role;
grant usage on schema public to service_role;
`+wrappers.map(x=>x.definition+';').join('\n')+`
revoke all on function public.icash_settle_estimated_operation(text),public.icash_settle_estimate_before_contact_refresh(text) from public,anon,authenticated,service_role;
grant execute on function public.icash_settle_estimated_operation(text) to service_role;
`+read('config/voice-pending-estimate-isolation.sql');
export const value=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
export const sourceHash=db=>value(db,'select md5(pg_get_functiondef($1::regprocedure))',[signature]);
export const metadata=db=>value(db,"select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=$1::regprocedure",[signature]);
export const financialState=db=>value(db,`select jsonb_build_object(
 'budget',(select jsonb_agg(to_jsonb(b) order by id) from icash_operating_budget b),
 'operations',(select jsonb_agg(to_jsonb(o)-'estimate_checked_at' order by operation_key) from icash_operation_spend o),
 'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w),
 'ledger',(select jsonb_agg(to_jsonb(l) order by event_key) from icash_credit_ledger l),
 'manifests',(select jsonb_agg(to_jsonb(m) order by operation_key) from icash_cost_manifests m))`);
export const sourceState=db=>value(db,`select jsonb_build_object(
 'owners',(select jsonb_agg(to_jsonb(r) order by operation_key,account_id) from icash_owner_contacts r),
 'searches',(select jsonb_agg(to_jsonb(r) order by operation_key,account_id) from icash_discovery_results r),
 'buyers',(select jsonb_agg(to_jsonb(r) order by operation_key,deal_id) from icash_buyer_search_receipts r),
 'deals',(select jsonb_agg(to_jsonb(d) order by id) from icash_deal_files d),
 'observations',(select jsonb_agg(to_jsonb(o) order by event_key,source_ref) from icash_cost_observations o))`);
export async function seed(db,n,kind='owner_enrichment',state='dispatched'){
 const account=id(n),rate=id(1000+n),operation='synthetic:'+n,deal=id(2000+n);
 await db.query('insert into icash_accounts(id,bot_paused) values($1,false)',[account]);
 await db.query('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,1000,0)',[account]);
 await db.query('insert into icash_operation_rates(id,operation,version,costs_micros,charge_cents) values($1,$2,$3,$4,105)',[rate,kind,'synthetic-'+n,{dealmachine:250000,support_and_overhead:40000}]);
 await db.query("insert into icash_operation_spend(operation_key,account_id,rate_id,state,charge_cap_cents,reserved_micros,standard_cost_multiplier,elevenlabs_cost_multiplier,dealmachine_cost_multiplier,data_unit_cost_micros,data_cost_basis,cost_basis,created_at,dispatched_at) values($1,$2,$3,$4,105,350000,2,2,3,10000,'synthetic unit','unreconciled',now()-interval '2 hours',now()-interval '1 hour')",[operation,account,rate,state]);
 await db.query('insert into icash_deal_files(id,account_id) values($1,$2)',[deal,account]);
 return {account,rate,operation,deal,kind};
}
export async function receipt(db,item,{account=item.account,credits=24,observed=24,source=true}={}){
 const raw={creditsUsed:credits};
 if(item.kind==='owner_enrichment')await db.query('insert into icash_owner_contacts(operation_key,account_id,result) values($1,$2,$3)',[item.operation,account,raw]);
 else if(item.kind==='property_search')await db.query('insert into icash_discovery_results(operation_key,account_id,result) values($1,$2,$3)',[item.operation,account,raw]);
 else{
  const deal=account===item.account?item.deal:id(9999);
  if(account!==item.account)await db.query('insert into icash_deal_files(id,account_id) values($1,$2)',[deal,account]);
  await db.query('insert into icash_buyer_search_receipts(operation_key,deal_id,receipt) values($1,$2,$3)',[item.operation,deal,raw]);
 }
 if(source)await db.query("insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine',$1,$2,$3,'provider_credits')",[item.operation,item.kind==='owner_enrichment'?'dealmachine:owners:'+item.operation:item.kind==='property_search'?'dealmachine:search:'+item.operation:item.operation,observed]);
}
