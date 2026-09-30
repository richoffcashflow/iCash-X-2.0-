import {costCategories} from './cost-guard.ts';
import {voiceCostManifest, type VoiceCostInputs} from './voice-cost-settlement.ts';

// Only server-owned reviewed configuration is accepted. Never use analysis/model fields.
export type VoiceUsageDb=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
type Rule={kind:'fixed_estimate';amountMicros:number;evidenceRef:string}|{
 kind:'duration_estimate';unitSeconds:number;microsPerUnit:number;rounding:'exact'|'up';minimumUnits:number;
 evidenceRef:string;durationSource:'conversation_proxy';assumption:string;
};
export type VoiceUsagePolicy={version:string;rateId:string;operation:'seller_call'|'buyer_call'|'incoming_call';
 enabled:boolean;reviewedAt:string;validFrom:string;validUntil:string;evidenceRef:string;
 components:Record<Exclude<typeof costCategories[number],'elevenlabs'>,Rule>};
type Call={operation_key:string;conversation_id:string;state:string;completed_at:string|null;created_at:string;result:{durationSeconds?:number|null}|null};
const ref=(s:unknown):s is string=>typeof s==='string'&&s.trim().length>=10;
const eq=(s:string)=>encodeURIComponent(s);
/** Match PostgreSQL ceil(USD * 1000000), without binary float multiplication. */
export function usdMicros(value:unknown){
 if(typeof value!=='number'&&typeof value!=='string')throw Error('Missing provider USD receipt');
 const m=String(value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
 if(!m||!Number.isFinite(Number(value)))throw Error('Invalid provider USD receipt');
 const shift=6+Number(m[3]||0)-(m[2]?.length||0);
 if(Math.abs(shift)>100)throw Error('USD receipt out of range');
 const n=BigInt(m[1]+(m[2]||''));const d=BigInt(10)**BigInt(Math.abs(shift));
 const amount=Number(shift>=0?n*d:(n+d-BigInt(1))/d);
 if(!Number.isSafeInteger(amount)||amount<0)throw Error('USD receipt out of range');return amount;
}
export function readVoiceUsagePolicies(raw:string|undefined):VoiceUsagePolicy[]{
 if(!raw)return [];
 try{const p=JSON.parse(raw);return Array.isArray(p)?p:[];}catch{return [];}
}

export async function settleBoundVoiceUsage(db:VoiceUsageDb,accountId:string,callId:string,policies:VoiceUsagePolicy[]){
 const hold=(reason:string)=>({status:'held' as const,reason});
 const [call]=await db<Call[]>(`icash_live_conversations?id=eq.${eq(callId)}&account_id=eq.${eq(accountId)}&select=operation_key,conversation_id,state,completed_at,created_at,result`);
 if(!call||call.state!=='complete'||!call.completed_at)return hold('conversation_incomplete');
 let duration=call.result?.durationSeconds;
 if(!Number.isSafeInteger(duration)||duration!<0){
  const [observed]=await db<{amount:unknown;units:string}[]>(`icash_cost_observations?provider=eq.elevenlabs_duration&event_key=eq.${eq(call.conversation_id)}&source_ref=eq.${eq(call.operation_key)}&select=amount,units`);
  duration=observed&&observed.units==='seconds'&&observed.amount!==null?Number(observed.amount):null;
  if(!Number.isSafeInteger(duration)||duration!<0)return hold('duration_missing');
 }
 const [spend]=await db<{rate_id:string;state:string}[]>(`icash_operation_spend?operation_key=eq.${eq(call.operation_key)}&account_id=eq.${eq(accountId)}&select=rate_id,state`);
 if(!spend||!['dispatched','settled'].includes(spend.state))return hold('operation_unbound');
 const [rate]=await db<{operation:string}[]>(`icash_operation_rates?id=eq.${eq(spend.rate_id)}&select=operation`);
 const matches=policies.filter(p=>p?.enabled===true&&p.rateId===spend.rate_id&&p.operation===rate?.operation);
 if(matches.length!==1)return hold('reviewed_policy_missing');
 const policy=matches[0];const created=Date.parse(call.created_at);const reviewed=Date.parse(policy.reviewedAt);
 const from=Date.parse(policy.validFrom),until=Date.parse(policy.validUntil);
 if(!ref(policy.evidenceRef)||!ref(policy.version)||![created,reviewed,from,until].every(Number.isFinite)||reviewed>created||from>created||until<=created||from>=until)return hold('reviewed_policy_invalid');
 const observations=await db<{amount:unknown;units:string}[]>(`icash_cost_observations?provider=eq.elevenlabs&event_key=eq.${eq(call.conversation_id)}&source_ref=eq.${eq(call.operation_key)}&select=amount,units`);
 if(observations.length!==1||observations[0].units?.toLowerCase()!=='usd')return hold('provider_receipt_missing');
 let manifest:ReturnType<typeof voiceCostManifest>;
 try{
  if(!policy.components||Object.keys(policy.components).length!==costCategories.length-1)throw Error('Incomplete policy');
  const inputs={} as VoiceCostInputs;
  inputs.elevenlabs={kind:'receipt',amountMicros:usdMicros(observations[0].amount),evidenceRef:`elevenlabs inclusive USD observation:${call.conversation_id}:${call.operation_key}`};
  for(const category of costCategories){
   if(category==='elevenlabs')continue;
   const rule=policy.components[category];
   if(!rule||!ref(rule.evidenceRef))throw Error('Missing rule');
   if(rule.kind==='fixed_estimate')inputs[category]={kind:rule.kind,amountMicros:rule.amountMicros,evidenceRef:rule.evidenceRef};
   else if(rule.kind==='duration_estimate'&&rule.durationSource==='conversation_proxy'&&ref(rule.assumption))inputs[category]={kind:rule.kind,durationSeconds:duration!,unitSeconds:rule.unitSeconds,microsPerUnit:rule.microsPerUnit,rounding:rule.rounding,minimumUnits:rule.minimumUnits,evidenceRef:rule.evidenceRef,durationEvidenceRef:`ESTIMATED conversation-duration proxy:${call.conversation_id}; ${rule.assumption}`};
   else throw Error('Unsupported usage source');
  }
  manifest=voiceCostManifest(inputs);
 }catch{return hold('cost_evidence_incomplete');}
 // SQL rechecks account/conversation/receipt binding, quote ceiling, and immutable retries.
 // Do not swallow conflicts: automation must surface them for reconciliation.
 const ok=await db<boolean>('rpc/icash_settle_voice_usage','POST',{p_operation:call.operation_key,p_components:manifest.components,p_evidence:`voice usage policy:${policy.version}; ${policy.evidenceRef}`});
 return ok?{status:'settled' as const,costBasis:manifest.costBasis}:hold('ledger_review_required');
}

/** One fair, persisted attempt per invocation; held rows rotate instead of blocking later calls.
 * Generic estimate reconciliation must exclude voice rows from its fairness timestamp.
 * This is a claim, not settlement: every financial decision remains in the bound collector/SQL.
 */
export async function settlePendingVoiceUsage(database:VoiceUsageDb,accountId:string,policies:VoiceUsagePolicy[],
 reconcile?:(accountId:string,callId:string,signal?:AbortSignal)=>Promise<{billing?:{status:string}}>,
 signal?:AbortSignal){
 const summary={settled:0,held:0,reviewRequired:0};
 const rateIds=[...new Set(policies.filter(p=>p?.enabled===true&&typeof p.rateId==='string').map(p=>p.rateId))];
 if(!rateIds.length)return summary;
 const deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000);
 const db:VoiceUsageDb=(path,method,body)=>{deadline.throwIfAborted();return database(path,method,body,deadline);};
 const scope=`account_id=eq.${eq(accountId)}&state=eq.dispatched&rate_id=in.(${rateIds.map(id=>eq('"'+id+'"')).join(',')})`;
 const [spend]=await db<{operation_key:string;estimate_checked_at:string|null}[]>(`icash_operation_spend?${scope}&select=operation_key,estimate_checked_at&order=estimate_checked_at.asc.nullsfirst,operation_key.asc&limit=1`);
 if(!spend)return summary;
 // Compare-and-set lets only one contender advance a given observed timestamp.
 // This fairness touch is not a long-lived lease; ledger retries remain idempotent.
 // Touch before any slow provider request, including held/missing-call/error outcomes.
 const checkedAt=new Date(Math.max(Date.now(),spend.estimate_checked_at?Date.parse(spend.estimate_checked_at)+1:0)).toISOString();
 const claimed=await db<{operation_key:string}[]>(`icash_operation_spend?${scope}&operation_key=eq.${eq(spend.operation_key)}&estimate_checked_at=${spend.estimate_checked_at?'eq.'+eq(spend.estimate_checked_at):'is.null'}&select=operation_key`,'PATCH',{estimate_checked_at:checkedAt});
 if(!claimed.length)return summary;
 const [call]=await db<{id:string}[]>(`icash_live_conversations?account_id=eq.${eq(accountId)}&operation_key=eq.${eq(spend.operation_key)}&state=eq.complete&select=id&limit=1`);
 if(!call)return summary;
 try{
  deadline.throwIfAborted();
  const result=reconcile?(await reconcile(accountId,call.id,deadline)).billing:await settleBoundVoiceUsage(db,accountId,call.id,policies);
  if(result?.status==='settled')summary.settled++;else summary.held++;
 }catch{summary.reviewRequired++;} // Retried fairly later; never changes a completed primary action.
 return summary;
}
