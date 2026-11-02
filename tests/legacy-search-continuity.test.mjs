import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const account='00000000-0000-4000-8000-000000000021',ticket='00000000-0000-4000-8000-000000000221';
const operation='discovery:'+account+':00000000-0000-4000-8000-000000000121:7';
try{
 for(const p of ['tests/fixtures/account-work-repair.sql','tests/fixtures/legacy-search-recovery.sql','config/standing-research-continuity.sql','config/legacy-search-continuation.sql'])await pg.exec(read(p));
 const hashes=await one("select jsonb_build_array(md5(to_jsonb(c)::text),md5((to_jsonb(o)-array['estimate_checked_at','financial_checked_at'])::text)) from icash_discovery_configs c,icash_operation_spend o");
 const args=[account,operation,...hashes,ticket],resume=(a=args)=>one('select icash_continue_legacy_research($1,$2,$3,$4,$5)',a);
 const snapshot=()=>one("select jsonb_build_object('config',(select to_jsonb(c) from icash_discovery_configs c),'money',(select to_jsonb(o) from icash_operation_spend o),'wallet',(select to_jsonb(w) from icash_wallets w),'quarantine',(select jsonb_agg(to_jsonb(s)) from icash_research_private.stalled_searches s))");
 assert.equal(await resume(),false,'disabled rollout');
 await pg.exec('update icash_research_private.settings set legacy_continuation_enabled=true');
 for(const change of [
  "update icash_accounts set bot_paused=true",
  "insert into icash_support_cancel_requests(account_id,confirmed_at) select id,now() from icash_accounts",
  "insert into icash_billing_reviews(account_id) select id from icash_accounts",
  "update icash_automation_tickets set completed_at=null",
  "update icash_automation_tickets set outcome='complete'",
  "update icash_automation_tickets set expires_at=created_at",
  "insert into icash_automation_tickets select account_id,kind,state,created_at,expires_at,gen_random_uuid(),outcome,completed_at from icash_automation_tickets",
  "insert into icash_research_private.requests select operation_key from icash_operation_spend",
  "insert into icash_cost_observations(provider,event_key) select 'dealmachine',operation_key from icash_operation_spend",
  "insert into icash_discovery_filter_pages select operation_key,account_id,gen_random_uuid(),7,'75201','claimed' from icash_operation_spend",
  "update icash_inventory_markets set eligible_until=now()-interval '1 day' where zip='75202'",
  "update icash_wallets set balance_cents=100",
 ]){
  await pg.exec('begin;'+change);const before=await snapshot();assert.equal(await resume(),false,change);assert.deepEqual(await snapshot(),before);await pg.exec('rollback');
 }
 for(const index of [2,3]){const wrong=[...args];wrong[index]='stale';assert.equal(await resume(wrong),false,'changed reviewed source');}
 await pg.exec('begin;update icash_operation_rates set charge_cents=999 where version like \'%:standing-research-20261026\';');
 await assert.rejects(resume(),/Standing research lineage unavailable/);await pg.exec('rollback');
 const before=await snapshot();assert.equal(await resume(),true);const after=await snapshot();
 assert.deepEqual(after.money,before.money);assert.deepEqual(after.wallet,before.wallet);
 assert.equal(after.config.zip,'75202');assert.equal(after.config.next_page,1);assert.notEqual(after.config.revision,before.config.revision);
 assert.equal(Date.parse(after.config.data_rights_until),Date.parse('9999-12-31T23:59:59Z'));
 assert.deepEqual(after.quarantine[0].configuration,before.config);assert.equal(after.quarantine[0].request_id,null);
 assert.equal(after.quarantine[0].legacy_evidence.ticket.id,ticket);assert.equal(after.quarantine[0].legacy_evidence.policy,'legacy-handler-v1');
 assert.equal(await resume(),false,'review cannot be reused');
 await assert.rejects(q("insert into icash_research_private.stalled_searches(operation_key,legacy_evidence) values('invalid','{}')"),/stalled_search_source_required/);
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_continue_legacy_research(uuid,text,text,text,uuid)','execute')",[role]),false);
 console.log('PASS legacy search continuation: original holds, exact local handler proof, no fabricated provider receipt, saved scope, atomic standing lineage and Pause.');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await pg.close();}
