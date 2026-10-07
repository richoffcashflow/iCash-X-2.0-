import {verifiedSigningStatus,type ProviderDocument} from './signing-policy.ts';

/** Observation only. Trusted server reads; no provider calls, writes or policy promotion. */
export type LearningReportDb=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Owned={account_id:string};
export type ObservedCall=Owned&{id:string;screening_id:string;party:string;strategy_key:string;conversation_id:string;operation_key:string;state:string;created_at:string;completed_at:string|null};
export type ObservedDeal=Owned&{id:string;screening_id:string;practice:string|null};
export type ObservedSpend=Owned&{operation_key:string;state:string;actual_micros:number|null;cost_basis:string;settlement_evidence:string|null;dispatched_at:string|null;settled_at:string|null};
export type ObservedEnvelope=Owned&{id:string;deal_id:string;kind:string;state:string;test_mode:boolean;provider_id:string|null;terms_hash:string;recipients:{id:string;email?:string|null;phone?:string|null}[];provider_evidence:ProviderDocument|null;updated_at:string};
export type LearningReportRecords={calls:ObservedCall[];deals:ObservedDeal[];spend:ObservedSpend[];envelopes:ObservedEnvelope[]};
const time=(value:string|null,now:number)=>value!==null&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now;
function unique<T>(rows:T[],key:(row:T)=>string){
 const found=new Map<string,T>();
 for(const row of rows){const id=key(row);if(!id)throw Error('Missing evidence key');const prior=found.get(id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw Error('Conflicting evidence');found.set(id,row);}
 return [...found.values()];
}
export function summarizeDealLearningEvidence(accountId:string,records:LearningReportRecords,now:number,complete=true){
 if(!accountId||!Number.isFinite(now))throw Error('Invalid report scope');
 for(const rows of Object.values(records))if(rows.some(r=>r.account_id!==accountId))throw Error('Mixed tenant evidence');
 const deals=unique(records.deals,r=>r.id).filter(d=>d.practice!== 'true');
 const dealIds=new Set(deals.map(d=>d.id)),screenings=new Set(deals.map(d=>d.screening_id));
 const spends=new Map(unique(records.spend,r=>r.operation_key).map(r=>[r.operation_key,r]));
 const allCalls=unique(records.calls,r=>r.operation_key);
 let excludedOrUnboundCalls=0,unverifiedCompletedSignings=0;
 const calls=allCalls.filter(c=>{
  const s=spends.get(c.operation_key);
  const bound=screenings.has(c.screening_id)&&['seller','buyer'].includes(c.party)&&!!c.conversation_id&&time(c.created_at,now)&&s&&['dispatched','settled'].includes(s.state)&&time(s.dispatched_at,now);
  if(!bound)excludedOrUnboundCalls++;return bound;
 });
 const groups=new Map<string,{party:string;strategy:string;recordedOperations:number;completedConversationRecords:number;settledOperations:number;verifiedCostMicros:number;estimatedCostMicros:number;unresolvedCostOperations:number}>();
 for(const c of calls){
  const key=JSON.stringify([c.party,c.strategy_key]);
  const g=groups.get(key)??{party:c.party,strategy:c.strategy_key,recordedOperations:0,completedConversationRecords:0,settledOperations:0,verifiedCostMicros:0,estimatedCostMicros:0,unresolvedCostOperations:0};
  g.recordedOperations++;
  if(c.state==='complete'&&time(c.completed_at,now)&&Date.parse(c.completed_at!)>=Date.parse(c.created_at))g.completedConversationRecords++;
  const s=spends.get(c.operation_key)!;
  if(s.state==='settled'&&time(s.settled_at,now)&&s.settlement_evidence?.trim()&&Number.isSafeInteger(s.actual_micros)&&s.actual_micros!>=0&&['verified','estimated'].includes(s.cost_basis)){
   g.settledOperations++;if(s.cost_basis==='verified')g.verifiedCostMicros+=s.actual_micros!;else g.estimatedCostMicros+=s.actual_micros!;
   if(!Number.isSafeInteger(g.verifiedCostMicros)||!Number.isSafeInteger(g.estimatedCostMicros))throw Error('Cost overflow');
  }else g.unresolvedCostOperations++;
  groups.set(key,g);
 }
 const purchases=new Set<string>(),assignments=new Set<string>();
 for(const e of unique(records.envelopes,r=>r.id)){
  if(e.test_mode||e.state!=='completed'||!dealIds.has(e.deal_id)||!time(e.updated_at,now))continue;
  try{
   if(!e.provider_id||!e.provider_evidence||!Array.isArray(e.recipients)||e.recipients.length<2||new Set(e.recipients.map(r=>r.id)).size!==e.recipients.length||!['purchase','assignment'].includes(e.kind))throw Error('Missing receipt');
   if(verifiedSigningStatus(e.provider_evidence,{providerId:e.provider_id,id:e.id,termsHash:e.terms_hash,testMode:false,recipients:e.recipients})!=='completed')throw Error('Incomplete receipt');
   (e.kind==='purchase'?purchases:assignments).add(e.deal_id);
  }catch{unverifiedCompletedSignings++;}
 }
 return {version:'deal-evidence-v1',asOf:new Date(now).toISOString(),mode:'observation_only',scope:'current_persisted_records',complete,automaticPromotion:false,
  strategyObservations:[...groups.values()].sort((a,b)=>a.party.localeCompare(b.party)||a.strategy.localeCompare(b.strategy)),
  signedPurchaseDeals:purchases.size,signedAssignmentDeals:assignments.size,closedDeals:null,
  excludedOrUnboundCalls,unverifiedCompletedSignings,
  limitations:['No controlled comparison or improvement claim.','Completed conversation records are not proof of a human connection, qualification or a closing.','Calls require a non-practice current deal file and dispatched operation; earlier or unbound calls are excluded.','Signing totals are independent observations, not attributed conversion rates.','Costs cover bound call operations only; estimated costs are separate and missing receipts are unresolved.','Closing/title receipt ingestion and versioned opportunity attribution remain unconnected.',...(complete?[]:['Read limit reached; counts are partial and must not be treated as complete totals.'])]};
}
/** Keyset pages preserve tenant scope. Limits are disclosed; never silently call partial data complete. */
export async function readDealLearningReport(db:LearningReportDb,accountId:string,now=Date.now()){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId))throw Error('Invalid account');
 let complete=true;
 async function read<T extends Owned>(table:string,select:string,key:string):Promise<T[]>{
  const rows:T[]=[];let after='';
  for(let page=0;page<5;page++){
   const batch=await db<T[]>(`${table}?account_id=eq.${accountId}&select=${select}&order=${key}.asc&limit=200${after?`&${key}=gt.${encodeURIComponent(after)}`:''}`);
   if(!Array.isArray(batch)||batch.length>200||batch.some(r=>r.account_id!==accountId))throw Error('Invalid evidence response');
   rows.push(...batch);if(batch.length<200)return rows;
   const next=(batch.at(-1) as Record<string,unknown>)[key];if(typeof next!=='string'||next===after)throw Error('Invalid evidence cursor');after=next;
  }
  complete=false;return rows;
 }
 const [calls,deals,spend,envelopes]=await Promise.all([
  read<ObservedCall>('icash_live_conversations','id,account_id,screening_id,party,strategy_key,conversation_id,operation_key,state,created_at,completed_at','id'),
  read<ObservedDeal>('icash_deal_files','id,account_id,screening_id,practice:terms->>practice','id'),
  read<ObservedSpend>('icash_operation_spend','account_id,operation_key,state,actual_micros,cost_basis,settlement_evidence,dispatched_at,settled_at','operation_key'),
  read<ObservedEnvelope>('icash_signing_envelopes','id,account_id,deal_id,kind,state,test_mode,provider_id,terms_hash,recipients,provider_evidence,updated_at','id'),
 ]);
 return summarizeDealLearningEvidence(accountId,{calls,deals,spend,envelopes},now,complete);
}
