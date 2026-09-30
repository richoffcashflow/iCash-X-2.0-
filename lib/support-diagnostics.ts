import {db} from '@/lib/stripe-test';
import {fundingMode} from '@/lib/funding-policy';
import {launchReadiness} from '@/lib/launch-readiness';
import type {SupportEvidence} from './support-policy';
const readinessLabels:Record<string,string>={dataProvider:'Property data access needs attention',voiceProvider:'Calling service access needs attention',emailAccess:'Email access needs attention',billing:'Billing configuration needs attention',cashReserve:'Operating reserve check needs attention',discovery:'Property search configuration needs attention',voice:'Calling configuration needs attention',productionContracts:'Production contract configuration needs review',unresolvedDispatches:'A provider action has an uncertain outcome',readiness_unavailable:'Readiness could not be checked'};
/** Fixed, tenant-bound reads only. Never return raw logs, provider payloads, credentials or another account. */
export async function collectSupportDiagnostics(accountId:string):Promise<SupportEvidence[]>{
 const observedAt=new Date().toISOString();
 const check=async(key:string,source:string,fn:()=>Promise<Omit<SupportEvidence,'key'|'source'|'observedAt'>>):Promise<SupportEvidence>=>{
  try{return {key,source,observedAt,...await fn()};}catch{return {key,source,observedAt,status:'unknown',detail:`The ${key} check is temporarily unavailable. Nothing was changed.`};}
 };
 return Promise.all([
  check('work','icash_accounts',async()=>{const [a]=await db<{bot_paused:boolean}[]>(`icash_accounts?id=eq.${accountId}&select=bot_paused`);if(!a)throw Error();return {status:a.bot_paused?'attention':'ok',detail:a.bot_paused?'Your bot is paused. It will not start new work until you resume it.':'Your bot is not paused. Other safety and readiness checks still apply.'};}),
  check('credits','icash_wallets',async()=>{const [w]=await db<{balance_cents:number;reserved_cents:number}[]>(`icash_wallets?account_id=eq.${accountId}&select=balance_cents,reserved_cents`);if(!w)throw Error();const available=w.balance_cents-w.reserved_cents;return {status:available>0?'ok':'attention',detail:available>0?'The live-work wallet has available credit. Pending reservations remain held.':'The live-work wallet has no unreserved credit. Test checkout credit is separate.'};}),
  check('billing','icash_daily_plans',async()=>{const mode=fundingMode();if(!mode)throw Error('MODE_UNAVAILABLE');const plans=await db<{state:string}[]>(`icash_daily_plans?account_id=eq.${accountId}&mode=eq.${mode}&state=neq.stopped&select=state&limit=5`);const stopping=plans.some(p=>p.state==='stop_requested'),failed=plans.some(p=>p.state==='payment_failed');return {status:stopping||failed?'attention':'ok',detail:stopping?'A stop request is saved, but daily billing cancellation is not yet confirmed. The team should review it.':failed?'A daily plan has a payment issue and needs review.':plans.some(p=>p.state==='active')?`A ${mode} daily renewal plan is active in this environment. Review cancellation below to stop future renewals.`:plans.length?'A daily checkout is pending. A pending checkout is not proof of payment.':`No ongoing ${mode} daily renewal plan was found in this environment.`};}),
  check('screening','icash_screening_jobs',async()=>{const rows=await db<{state:string}[]>(`icash_screening_jobs?account_id=eq.${accountId}&state=in.(failed,held,dispatching)&select=state&limit=20`);return {status:rows.length?'attention':'ok',detail:rows.length?`${rows.length}${rows.length===20?'+':''} property checks are failed, held, or awaiting a provider result. No paid checks were retried.`:'No failed or held property checks were found in this check.'};}),
  check('voice','icash_live_conversations',async()=>{const rows=await db<{state:string}[]>(`icash_live_conversations?account_id=eq.${accountId}&state=eq.review&select=state&limit=20`);return {status:rows.length?'attention':'ok',detail:rows.length?`${rows.length}${rows.length===20?'+':''} call results need review. Chat will not redial or repeat provider actions.`:'No call results marked for review were found.'};}),
  check('readiness','icash_launch_checks',async()=>{const r=await launchReadiness(accountId);return {status:r.ready?'ok':r.blockers.includes('readiness_unavailable')?'unknown':'attention',detail:r.ready?'The launch-readiness check passed. This does not guarantee individual outreach or a completed deal.':`Readiness needs attention: ${r.blockers.map(b=>readinessLabels[b]??'An operational safety check needs review').join('; ')}.`};}),
 ]);
}
/** Owner-only deployment health. Fixed endpoint and server configuration, never model-controlled URLs. */
export async function supportDeploymentHealth(fetcher:typeof fetch=fetch){
 const token=process.env.ICASH_SUPPORT_VERCEL_TOKEN,project=process.env.VERCEL_PROJECT_ID;
 if(!token||!project)return {status:'unavailable',detail:'Vercel read-only diagnostics are not configured.'};
 const query=new URLSearchParams({projectId:project,target:'production',limit:'1'});if(process.env.VERCEL_TEAM_ID)query.set('teamId',process.env.VERCEL_TEAM_ID);
 try{
  const r=await fetcher(`https://api.vercel.com/v6/deployments?${query}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error();
  const data=await r.json();const d=data.deployments?.[0];if(!d)throw Error();
  const state=['READY','ERROR','BUILDING','QUEUED','CANCELED','INITIALIZING'].includes(d.state)?d.state:'UNKNOWN';
  return {status:state,detail:`Latest production deployment: ${state}. This is deployment health, not proof that every request succeeded.`,deploymentId:typeof d.uid==='string'?d.uid:null,errorCode:typeof d.errorCode==='string'&&/^[A-Z0-9_]{1,100}$/.test(d.errorCode)?d.errorCode:null};
 }catch{return {status:'unavailable',detail:'Vercel health could not be verified. No deployment changes were attempted.'};}
}
