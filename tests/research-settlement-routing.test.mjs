import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {costCategories} from '../lib/cost-guard.ts';
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const costs=Object.fromEntries(costCategories.map(k=>[k,k==='dealmachine'?250000:k==='support_and_overhead'?40000:0]));
async function seed(n,{used=25,kind='property_search',receipt=true,observed=true}={}){
 const a=id(n),r=id(1000+n),op=(kind==='owner_enrichment'?'owners:':'discovery:')+a+':fixture';
 await q("insert into icash_accounts(id,owner_user_id,bot_paused,created_at,workspace_ack_version) values($1,$1,false,now()-interval '2 days','fixture')",[a]);
 await q("insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,1000,0)",[a]);
 await q("insert into icash_operation_rates(id,operation,version,costs_micros,charge_cents,enabled,verified_at,expires_at) values($1,$2,$3,$4,105,true,now()-interval '1 day',now()+interval '1 day')",[r,kind,'fixture-'+n,costs]);
 await q("insert into icash_operation_spend(operation_key,account_id,rate_id,state,charge_cap_cents,reserved_micros,standard_cost_multiplier,elevenlabs_cost_multiplier,dealmachine_cost_multiplier,data_unit_cost_micros,data_cost_basis,created_at,dispatched_at) values($1,$2,$3,'dispatched',105,350000,2,2,3,10000,'fixture unit',now()-interval '2 hours',now()-interval '2 hours')",[op,a,r]);
 if(receipt)await q(kind==='owner_enrichment'?"insert into icash_owner_contacts(screening_id,account_id,operation_key,result) values($1,$2,$3,$4)":"insert into icash_discovery_results(operation_key,account_id,result,created_at) values($3,$2,$4,now()+case when $1::uuid is not null then interval '0 seconds' else interval '0 seconds' end)",[id(2000+n),a,op,{creditsUsed:used}]);
 if(observed)await q("insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine',$1,$2,$3,'provider_credits')",[op,'dealmachine:'+(kind==='owner_enrichment'?'owners:':'search:')+op,used]);
 return {a,r,op};
}
try{
 await pg.exec(read('tests/fixtures/account-work-repair.sql'));
 const bad=await seed(1),over=await seed(2,{used:1,kind:'owner_enrichment'}),manual=await seed(3),changed=await seed(4);
 for(const c of [bad,over,manual,changed]){
  assert.equal(await one('select icash_settle_estimate_before_sms_tokens($1)',[c.op]),true);
  assert.equal(await one('select bot_paused from icash_accounts where id=$1',[c.a]),true,'legacy race reproduces automatic pause');
 }
 await q("insert into icash_control_events(id,account_id,actor_user_id,action,created_at) values($1,$2,$2,'pause',now())",[id(9001),manual.a]);
 const before=await one('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o');
 await pg.exec(read('config/research-settlement-routing.sql'));
 for(const c of [bad,over,manual,changed])assert.equal((await one('select icash_correct_legacy_research_settlement($1)',[c.op])).corrected,true);
 assert.equal(await one('select balance_cents from icash_wallets where account_id=$1',[over.a]),989,'only observed-credit overcharge is credited; no additional debit');
 assert.equal(await one("select count(*) from icash_credit_ledger where event_key like 'research-correction:%'"),1);
 await one('select icash_correct_legacy_research_settlement($1)',[over.op]);
 assert.equal(await one('select balance_cents from icash_wallets where account_id=$1',[over.a]),989,'idempotent credit');
 assert.deepEqual(await one('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o'),before,'original operation and cost evidence stays unchanged');
 assert.equal(await one('select icash_resume_corrected_research_pause($1)',[bad.a]),true);
 assert.equal(await one('select icash_resume_corrected_research_pause($1)',[bad.a]),false);
 assert.equal(await one('select icash_resume_corrected_research_pause($1)',[manual.a]),false,'explicit Pause preserved');
 await q("insert into icash_control_events(id,account_id,actor_user_id,action,created_at) values($1,$2,$2,'pause',now())",[id(9002),changed.a]);
 assert.equal(await one('select icash_resume_corrected_research_pause($1)',[changed.a]),false,'new Pause wins after correction');
 const fresh=await seed(5,{used:24});
 assert.equal(await one('select icash_settle_estimate_before_sms_tokens($1)',[fresh.op]),true);
 assert.equal(await one('select charged_cents from icash_operation_spend where operation_key=$1',[fresh.op]),80,'maintenance uses saved 3x data and actual 24 credits');
 assert.equal(await one('select bot_paused from icash_accounts where id=$1',[fresh.a]),false);
 const unknown=await seed(6,{receipt:false});
 assert.equal(await one('select icash_settle_estimate_before_sms_tokens($1)',[unknown.op]),false);
 assert.equal(await one('select state from icash_operation_spend where operation_key=$1',[unknown.op]),'dispatched');
 const noObservation=await seed(7,{observed:false});
 assert.equal(await one('select icash_settle_estimate_before_sms_tokens($1)',[noObservation.op]),false,'receipt alone cannot bypass observed-cost binding');
 await q("update icash_operation_spend set actual_micros=actual_micros+1 where operation_key=$1",[bad.op]);
 assert.equal(await one('select icash_account_margin_ok($1,0,0,false)',[bad.a]),false,'changed original evidence invalidates margin exception');
 for(const role of ['anon','authenticated'])for(const fn of ['icash_correct_legacy_research_settlement(text)','icash_resume_corrected_research_pause(uuid)'])assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
 console.log('PASS reproduced legacy pause, observed-credit settlement, immutable correction, exact one-use credits, changed-evidence rejection, Pause fencing and unknown receipt holds.');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await pg.close();}
