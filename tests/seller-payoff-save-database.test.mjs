import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {automaticCallOffer} from '../lib/automatic-call-offer.ts';
import {sellerPayoffEvidence,sellerPayoffRecovery} from '../lib/seller-payoff.ts';
import {callOfferEvidence} from '../lib/call-offer-evidence.ts';

// Exercise the real offer save boundary. A recovered transcript must never
// smuggle a changed quote through accept_offer or overwrite a competing update.
const sql=readFileSync(new URL('../config/automatic-call-offer.sql',import.meta.url),'utf8');
const save=sql.match(/create function public\.icash_save_call_offer\([\s\S]*?\nend \$\$;/)?.[0];
assert(save,'The canonical save function must be present');
const db=new PGlite();
const account='10000000-0000-4000-8000-000000000001',deal='20000000-0000-4000-8000-000000000002',screen='30000000-0000-4000-8000-000000000003';
await db.exec(`
 create schema icash_call_offer_private;
 create table public.icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text);
 create table public.icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb);
 create table icash_call_offer_private.offers(deal_id uuid primary key,account_id uuid,state jsonb,snapshot jsonb,version bigint default 1,updated_at timestamptz default now());
 create table icash_call_offer_private.events(deal_id uuid,account_id uuid,call_key text,action text,state jsonb);
 create function public.icash_seller_agreement_call_context(text,text) returns jsonb language sql as $$
  select case when $1=repeat('a',64) and $2='conv_fixture' then jsonb_build_object('accountId','${account}','dealId','${deal}','callKey','outbound:fixture') else null end
 $$;
 insert into public.icash_deal_files values('${deal}','${account}','${screen}','draft');
 insert into public.icash_screening_jobs values('${screen}','${account}','complete','{"fixture":"current"}');
 ${save}
`);
const snapshot={fixture:'current'},original={quoteRevision:'b'.repeat(64),quotedPriceCents:9000000,payoffReport:{mortgageCents:2000000},contractBlocked:true};
const repaired={...original,quoteRevision:'c'.repeat(64),payoffReport:{mortgageCents:2000000,otherDebtCents:0},contractBlocked:false,acceptanceConditional:false};
const accepted={...repaired,acceptedPriceCents:9000000};
const write=async(version,state,action='get_offer',expected=snapshot,conversation='conv_fixture')=>(await db.query('select public.icash_save_call_offer($1,$2,$3,$4::jsonb,$5::jsonb,$6) as saved',['a'.repeat(64),conversation,version,JSON.stringify(expected),JSON.stringify(state),action])).rows[0].saved;
assert.equal(await write(0,original),true);
assert.equal(await write(1,accepted,'accept_offer'),false,'An unseen repaired revision cannot be accepted in one save');
assert.equal(await write(1,repaired),true,'Persist the recovered quote through its own guarded save');
assert.equal(await write(1,accepted,'accept_offer'),false,'The previous version cannot overwrite the repair');
assert.equal(await write(2,{...accepted,acceptedPriceCents:9100000},'accept_offer'),false,'The accepted amount must equal the saved exact quote');
assert.equal(await write(2,accepted,'accept_offer',{fixture:'stale'}),false,'Research changes invalidate the save');
assert.equal(await write(2,accepted,'accept_offer',snapshot,'conv_other'),false,'Another conversation cannot use this capability');
assert.equal(await write(2,accepted,'accept_offer'),true);
assert.equal(await write(3,accepted,'accept_offer'),true,'An exact duplicate is idempotent');
const events=(await db.query('select action,state from icash_call_offer_private.events')).rows;
assert.deepEqual(events.map(r=>r.action),['get_offer','get_offer','accept_offer']);
assert.deepEqual(events[0].state,original,'Original conditional quote evidence remains immutable');
assert.deepEqual(events[2].state,accepted);

// Run the actual application against the same real save function, rather than
// a permissive mock that would miss the database's old-revision rejection.
await db.exec('truncate icash_call_offer_private.offers,icash_call_offer_private.events');
const now=Date.now(),property={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:'45 Fixture Lane',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90,num_total_active_liens:1}}};
await db.query('update public.icash_screening_jobs set snapshot=$1::jsonb',[JSON.stringify(property)]);
const history={transcript:[{role:'agent',message:'What is the current mortgage payoff balance?'},{role:'user',message:'The mortgage is $20,000.'}]};
const dependencies={now:()=>now,bind:async()=>{},verifyQualification:async()=>({ready:true}),
 verifyInput:async(input,continuity)=>callOfferEvidence(history,input,continuity),
 verifyPayoffFacts:async input=>sellerPayoffEvidence(history,input),
 recoverPayoffFacts:async(input,mortgage,price)=>sellerPayoffRecovery(history,mortgage,price),
 db:async(path,method,body)=>{
  if(path==='rpc/icash_call_offer_context'){
   const row=(await db.query('select state,version from icash_call_offer_private.offers where deal_id=$1',[deal])).rows[0];
   return {party:'seller',accountId:account,dealId:deal,screeningId:screen,phone:'+12025550123',address:'45 Fixture Lane',snapshot:property,offerState:row?.state??null,offerVersion:Number(row?.version??0)};
  }
  assert.equal(path,'rpc/icash_save_call_offer');
  return (await db.query('select public.icash_save_call_offer($1,$2,$3,$4::jsonb,$5::jsonb,$6) as saved',[body.p_hash,body.p_conversation,body.p_expected_version,JSON.stringify(body.p_expected_snapshot),JSON.stringify(body.p_state),body.p_action])).rows[0].saved;
 }
};
// The fixture context authorizes the real capability hash, not the raw token.
const {sha}=await import('../lib/required-call-recording.ts');
await db.exec(`create or replace function public.icash_seller_agreement_call_context(text,text) returns jsonb language sql as $$
 select case when $1='${sha('a'.repeat(64))}' and $2='conv_fixture' then jsonb_build_object('accountId','${account}','dealId','${deal}','callKey','outbound:fixture') else null end $$;`);
const quote=await automaticCallOffer('a'.repeat(64),{action:'report_change',conversationId:'conv_fixture',sellerStatement:'The mortgage is $20,000.'},dependencies);
assert.equal(quote.contractAllowed,false);
history.transcript.push({role:'tool',tool_results:[{tool_name:'icash_offer_and_contract',is_error:false,result_value:JSON.stringify(quote)}]},
 {role:'agent',message:'Are there any other loans, liens, unpaid taxes or HOA balances besides that mortgage?'},{role:'user',message:'No.'},
 {role:'agent',message:'We can offer $90,000 cash, as is. Does that work?'},{role:'user',message:'Yes.'});
const result=await automaticCallOffer('a'.repeat(64),{action:'accept_offer',conversationId:'conv_fixture',priceCents:9000000,quoteRevision:quote.quoteRevision},dependencies);
assert.equal(result.status,'verbally_accepted');assert.equal(result.contractAllowed,true);
const saved=(await db.query('select state from icash_call_offer_private.offers where deal_id=$1',[deal])).rows[0].state;
assert.equal(saved.acceptedPriceCents,9000000);assert.deepEqual(saved.payoffReport,{mortgageCents:2000000,otherDebtCents:0});
assert.equal(saved.acceptanceConditional,false);assert.equal(saved.contractBlocked,false);
assert.deepEqual((await db.query('select action from icash_call_offer_private.events')).rows.map(r=>r.action),['report_change','get_offer','accept_offer']);
await db.close();
console.log('PASS real application and offer-save SQL recover missed debt through two guarded saves; exact price/version/snapshot/conversation binding and idempotent acceptance remain. No production writes.');
