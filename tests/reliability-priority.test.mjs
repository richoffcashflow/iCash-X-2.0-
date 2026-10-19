import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {reliabilityPriority} from '../lib/reliability-priority.ts';
import {reliabilityAlertClaimSchema,reliabilityAlertStatusSchema} from '../lib/reliability-alerts.ts';
const pg=await PGlite.create(),owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,now=Date.now();
const one=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0])[0];
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const issue=(kind='seller_response',minutes=6,account=1)=>({kind,since:new Date(now-minutes*60000).toISOString(),accountId:id(account),resourceId:id(100+account)});
const report=(issues=[])=>({status:issues.length?'degraded':'ok',fresh:true,components:{worker:{status:'ok',checkedAt:new Date(now).toISOString()},maintenance:{status:'ok',checkedAt:new Date(now).toISOString()}},snapshot:{issueCount:issues.length,issues,checkedAt:new Date(now).toISOString(),texts:{accepted:0,delivered:0,review:0},contracts:{created:0,completed:0,review:0}}});
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema icash_reliability_private;grant usage on schema icash_reliability_private to service_role;
 create table public.icash_accounts(id uuid primary key,owner_user_id uuid);create table public.fixture_monitor(report jsonb);
 create function public.icash_reliability_status() returns jsonb language sql as $$select report from public.fixture_monitor limit 1$$;`);
 await pg.exec(read('config/workspace-experience-and-incidents.sql'));
 const sql=read('config/reliability-incident-severity.sql');assert.equal(sql,read('supabase/migrations/20261019004544_reliability_incident_severity.sql'));await pg.exec(sql);
 const core=report([issue()]);core.components.worker.status='unavailable';
 const stale=report([issue()]);stale.fresh=false;
 const broad=report([issue('seller_response',6,1),issue('seller_response',6,2),issue('screening_lease',6,3)]);
 const cases=[[report(),null],[report([issue()]),'minor'],[report([issue('buyer_fulfillment',11)]),'minor'],[report([issue('seller_response',29.99)]),'minor'],[report([issue('seller_response',30)]),'high'],[report([issue('text_receipt')]),'high'],[report([issue('call_receipt')]),'high'],[report([issue('contract_delivery')]),'high'],[broad,'high'],[{...report([issue()]),snapshot:{...report([issue()]).snapshot,issueCount:5}},'high'],[core,'critical'],[stale,'high'],[null,'high']];
 for(const [value,expected] of cases){assert.equal(reliabilityPriority(value,now),expected);assert.equal(await one('select icash_reliability_severity($1,$2)',[value,new Date(now).toISOString()]),expected,'database and UI severity agree');}
 await pg.query('insert into fixture_monitor values($1)',[report([issue()])]);
 const set=async(value)=>{await pg.query('update fixture_monitor set report=$1',[value]);await one("select icash_refresh_reliability_incident('ready')");};
 const claim=async()=>{const value=await one('select icash_claim_reliability_notification_v2()');return value===null?null:reliabilityAlertClaimSchema.parse(value);};
 const finish=(value)=>one('select icash_finish_reliability_notification($1,$2)',[value.id,id(500)]);
 const status=async()=>reliabilityAlertStatusSchema.parse(await one('select icash_reliability_alert_status_v2($1)',[owner]));
 await set(report([issue()]));let item=await claim();assert.equal(item.severity,'minor');await finish(item);const incident=item.incidentId;
 await set(report([issue()]));assert.equal(await claim(),null,'unchanged minor is not repeated');
 await set(report([issue('seller_response',31)]));item=await claim();assert.equal(item.severity,'high');assert.equal(item.incidentId,incident);await finish(item);
 await set(report([issue()]));assert.equal((await status()).active.severity,'minor');assert.equal(await claim(),null,'downgrade is visible without another email');
 await set(report([issue('seller_response',31)]));assert.equal(await claim(),null,'severity oscillation does not resend the same level');
 await set(core);item=await claim();assert.equal(item.severity,'critical');await finish(item);
 await set(core);assert.equal(await claim(),null);
 await set(report());item=await claim();assert.equal(item.event,'recovered');await finish(item);assert.equal((await status()).active,null);
 await assert.rejects(one('select icash_reliability_alert_status_v2($1)',[id(999)]),/Owner required/);
 for(const role of ['anon','authenticated'])for(const fn of ['icash_reliability_severity(jsonb,timestamptz)','icash_claim_reliability_notification_v2()','icash_reliability_alert_status_v2(uuid)'])assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
 console.log('PASS priority parity, minor/high/critical thresholds, age and scope escalation, one alert per increased level, recovery and private owner-only status.');
}finally{await pg.close();}
