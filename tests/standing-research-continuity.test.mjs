import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const old='2026-10-29T14:41:50.348487Z',standing='9999-12-31T23:59:59Z';
try{
 await pg.exec(read('tests/fixtures/account-work-repair.sql'));
 await pg.exec(read('config/standing-research-continuity.sql'));
 for(let n=1;n<=2;n++){
  await q("insert into icash_operation_rates(id,operation,version,enabled,expires_at,charge_cents) values($1,$2,$3,true,$4,100)",[id(n),n===1?'property_search':'owner_enrichment','fixture-'+n,old]);
  await q("insert into icash_operation_rates select (jsonb_populate_record(null::icash_operation_rates,to_jsonb(r)||jsonb_build_object('id',$2::uuid,'version',version||':standing-research-20261026','expires_at',$3::timestamptz))).* from icash_operation_rates r where id=$1",[id(n),id(n+10),standing]);
  await q("insert into icash_owner_review_private.changes select 'rate',a.id::text,to_jsonb(a),to_jsonb(b),'fixture approval',now() from icash_operation_rates a,icash_operation_rates b where a.id=$1 and b.id=$2",[id(n),id(n+10)]);
 }
 for(let n=21;n<=26;n++){
  await q("insert into icash_accounts(id,bot_paused) values($1,$2)",[id(n),n===22]);
  await q("insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,1000,0)",[id(n)]);
  await q("insert into icash_discovery_configs(account_id,enabled,auto_enabled,contacts_enabled,rate_id,contact_rate_id,zip,revision,next_page,per_page,property_credit_micros,data_rights_until,next_run_at) values($1,true,true,true,$2,$3,'75201',$4,7,25,10000,$5,now()-interval '1 day')",[id(n),id(1),id(2),id(100+n),old]);
  await q("insert into icash_research_private.account_rates values($1,$2)",[id(n),id(1)]);
  await q("insert into icash_inventory_markets(account_id,zip,priority,eligible_until) values($1,'75201',1,$2)",[id(n),old]);
 }
 const independent='discovery:original-quarantined',current='discovery:original-current';
 await q("insert into icash_operation_spend(operation_key,account_id,rate_id,state,charge_cap_cents) values($1,$2,$3,'dispatched',100),($4,$5,$3,'dispatched',100)",[independent,id(21),id(1),current,id(23)]);
 await q("insert into icash_research_private.stalled_searches(operation_key,account_id,zip,configuration) values($1,$2,'75202',jsonb_build_object('account_id',$2::uuid,'rate_id',$3::uuid,'zip','75202'))",[independent,id(21),id(1)]);
 const before=await one('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o');
 const prior=await one('select to_jsonb(c) from icash_discovery_configs c where account_id=$1',[id(21)]);
 assert.equal(await one('select icash_repair_standing_research($1)',[id(21)]),true);
 assert.equal(await one('select icash_repair_standing_research($1)',[id(21)]),false,'idempotent');
 const after=await one('select to_jsonb(c) from icash_discovery_configs c where account_id=$1',[id(21)]);
 for(const key of ['zip','revision','next_page','per_page','property_credit_micros'])assert.equal(after[key],prior[key]);
 assert.equal(Date.parse(after.data_rights_until),Date.parse(standing));
 assert.equal(await one('select icash_repair_standing_research($1)',[id(22)]),false,'customer Pause preserved');
 assert.equal(await one('select icash_repair_standing_research($1)',[id(23)]),false,'current unknown purchase retains original configuration');
 await q("update icash_discovery_configs set enabled=false where account_id=$1",[id(24)]);
 assert.equal(await one('select icash_repair_standing_research($1)',[id(24)]),false,'disabled settings preserved');
 await q("insert into icash_support_cancel_requests(account_id,confirmed_at) values($1,now())",[id(26)]);
 assert.equal(await one('select icash_repair_standing_research($1)',[id(26)]),false,'confirmed cancellation preserved');
 await q("update icash_operation_rates set charge_cents=999 where id=$1",[id(11)]);
 assert.equal(await one('select icash_repair_standing_research($1)',[id(25)]),false,'changed economics cannot inherit standing review');
 assert.deepEqual(await one('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o'),before);
 assert.equal(await one('select count(*) from icash_inventory_markets where account_id=$1',[id(21)]),1,'scope never expands');
 for(const role of ['anon','authenticated'])assert.equal(await one('select has_function_privilege($1,\'icash_repair_standing_research(uuid)\',\'execute\')',[role]),false);
 console.log('PASS standing review continuation preserves unknown purchases, quarantined ZIPs, cursor, scope, manual Pause and immutable economics.');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await pg.close();}
