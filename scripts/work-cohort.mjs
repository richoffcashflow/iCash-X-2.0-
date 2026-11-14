// Read-only query rendering and append-only private observations. No dispatch.
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const date=x=>typeof x==='string'?Date.parse(x.replace(' ','T').replace(/\.(\d{3})\d+/,'.$1').replace(/([+-]\d{2})$/,'$1:00')):NaN;
const members=baseline=>{
 const ids=baseline.accounts.map(a=>a.id).sort();
 if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>! /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))throw Error('INVALID_FIXED_COHORT');
 return ids;
};
export function renderCohortQuery(baseline){
 const ids=members(baseline);
 return readFileSync(new URL('./observe-work-cohort.sql',import.meta.url),'utf8').replace('__ICASH_COHORT_IDS__',JSON.stringify(ids));
}
export function summarizeAccount(a,asOf){
 const at=date(asOf),tags=[];
 if(!Number.isFinite(at)||!a||a.unknown||a.created_at==null)return {status:'unknown',tags:['observation_missing']};
 if(a.bot_paused&&a.control_action==='pause')return {status:'intentional_wait',tags:['customer_pause']};
 if(a.membership_allowed===false)return {status:'intentional_wait',tags:['membership_not_current']};
 if(a.cancellation===true)return {status:'intentional_wait',tags:['customer_cancellation']};
 if(a.billing_review===true)return {status:'intentional_wait',tags:['billing_review']};
 if(a.acknowledged===false)return {status:'intentional_wait',tags:['acknowledgment_required']};
 if(a.membership_allowed!==true||a.acknowledged!==true)return {status:'unknown',tags:['eligibility_unknown']};
 if(a.bot_paused)return {status:'needs_investigation',tags:['unexpected_pause']};
 if([a.enabled,a.auto_enabled,a.contacts_enabled,a.search_enabled,a.contact_enabled].some(v=>v!==true))return {status:'needs_investigation',tags:['configuration_not_ready']};
 if([a.data_rights_until,a.search_expires,a.contact_expires].some(t=>!Number.isFinite(date(t))||date(t)<=at))return {status:'needs_investigation',tags:['configuration_expired_or_unknown']};
 if(!Number.isFinite(a.prospecting_available_cents)||!Number.isFinite(a.search_minimum)||!Number.isFinite(a.contact_minimum))return {status:'unknown',tags:['available_budget_unknown']};
 if(a.contacts?.expired>0)tags.push('expired_contacts');
 if(a.contacts?.current>0&&a.contacts?.hours_open===0)tags.push('contact_hours_closed');
 if(a.operations?.pending>0)tags.push('original_operations_pending');
 const outputs=a.research_receipts??[];
 if(outputs.some(x=>date(x.createdAt)<=at&&date(x.createdAt)>at-1800000))return {status:'recent_completed_work',tags};
 const affordable=a.prospecting_available_cents>=a.search_minimum||!!a.enrichment_candidate&&a.prospecting_available_cents>=a.contact_minimum;
 if(!affordable&&!a.operations?.pending)return {status:'intentional_wait',tags:[...tags,'no_affordable_current_target']};
 // No receipt != a failure, and a mutable healthy flag != completed work.
 // Provider/quota/source uncertainty requires case investigation, not replay.
 return {status:'needs_investigation',tags:[...tags,affordable?'affordable_work_without_recent_output':'pending_originals_without_affordable_new_work']};
}
export function createObservation(baseline,rows,previous=null){
 const ids=members(baseline),membershipHash=hash(ids);
 if(previous&&(previous.cohortId!==baseline.cohortId||previous.membershipHash!==membershipHash||hash(previous.payload)!==previous.hash))throw Error('COHORT_HISTORY_CHANGED');
 if(!Array.isArray(rows)||!rows.length)throw Error('EMPTY_OBSERVATION');
 const asOf=rows[0].observed_at;
 if(!Number.isFinite(date(asOf))||rows.some(r=>r.observed_at!==asOf))throw Error('INCONSISTENT_OBSERVATION_TIME');
 if(previous&&date(asOf)<=date(previous.payload.asOf))throw Error('OBSERVATION_NOT_FORWARD');
 const map=new Map();for(const row of rows){const a=row.evidence;if(!a||!ids.includes(a.id)||map.has(a.id))throw Error('COHORT_MEMBERSHIP_MISMATCH');map.set(a.id,a);}
 const accounts=ids.map(id=>{const evidence=map.get(id)??{id,unknown:'missing_from_observation'};return {id,classification:summarizeAccount(evidence,asOf),evidence};});
 const counts={enrolled:ids.length,intentional_wait:0,unknown:0,needs_investigation:0,recent_completed_work:0,researchOutputs24h:0,callProviderIds24h:0,callTimesUnknown:0,textAccepted24h:0,textDelivered24h:0,textAwaitingReceipt:0};
 for(const a of accounts){counts[a.classification.status]++;
  const since=date(asOf)-86400000,within=t=>date(t)>=since&&date(t)<=date(asOf);
  counts.researchOutputs24h+=(a.evidence.research_receipts??[]).filter(r=>within(r.createdAt)).length;
  counts.callProviderIds24h+=new Set((a.evidence.call_receipts??[]).filter(r=>r.providerId&&within(r.dialClaimedAt)).map(r=>r.providerId)).size;
  counts.callTimesUnknown+=(a.evidence.call_receipts??[]).filter(r=>r.providerId&&!Number.isFinite(date(r.dialClaimedAt))).length;
  const texts=a.evidence.text_receipts??[];
  counts.textAccepted24h+=texts.filter(t=>t.providerId&&['accepted','delivered'].includes(t.state)&&within(t.createdAt)).length;
  counts.textDelivered24h+=texts.filter(t=>t.providerId&&t.state==='delivered'&&t.deliveryAt&&within(t.createdAt)).length;
  counts.textAwaitingReceipt+=texts.filter(t=>t.providerId&&t.state==='accepted'&&!t.deliveryAt).length;
 }
 const payload={schemaVersion:2,cohortId:baseline.cohortId,membershipHash,asOf,previousHash:previous?.hash??null,
  callWindowBasis:'Original source-bound dial claim with provider ID; missing timing remains unknown. Schema 1 used job-updated time and cannot establish attempt-window counts.',
  observationGap:previous?date(asOf)-date(previous.payload.asOf)>90*60000:null,
  provenPreventableStalls:null,verifiedAnswers:null,continuousZeroStallStreak:null,counts,accounts};
 return {cohortId:baseline.cohortId,membershipHash,hash:hash(payload),payload};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command,baselinePath,inputPath,directory]=process.argv.slice(2),baseline=JSON.parse(readFileSync(baselinePath,'utf8'));
 if(command==='sql')process.stdout.write(renderCohortQuery(baseline));
 else if(command==='append'){
  mkdirSync(directory,{recursive:true});const names=readdirSync(directory).filter(n=>/^observation-.*\.json$/.test(n)).sort();
  const previous=names.length?JSON.parse(readFileSync(resolve(directory,names.at(-1)),'utf8')):null;
  const result=createObservation(baseline,JSON.parse(readFileSync(inputPath,'utf8')),previous);
  const path=resolve(directory,'observation-'+new Date(date(result.payload.asOf)).toISOString().replaceAll(':','-')+'.json');
  writeFileSync(path,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({path,hash:result.hash,counts:result.payload.counts})+'\n');
 }else throw Error('Use sql BASELINE or append BASELINE ROWS PRIVATE_DIRECTORY');
}
