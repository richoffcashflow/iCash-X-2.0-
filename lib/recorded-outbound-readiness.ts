import {sellerContractToolId,sellerContractToolMatches} from './seller-contract-tool.ts';
import {boundedBytes} from './required-call-recording-provider.ts';
import {canonical,object,recordingAgentMatches,recordingBaseUrl,sha,sid,type RecordingReview} from './required-call-recording.ts';
import {inspectOutboundTools,type OutboundTemplate} from './owner-outbound-readiness.ts';
import {receptionWorkspacePostcallAbsent} from './general-reception.ts';

// Fixed observation target, never a stored approval or caller-selected provider proxy.
export const recordedOutboundTarget=Object.freeze({agentId:'agent_6701m406qmqjf1kr6ykw71vksjns',branchId:'agtbrch_3201m406tgpefqjargy3k092x849',versionId:'agtvrsn_2201m4aa08m4ex7trrzs0vevaasb',stopToolId:'tool_3401m40eg58jeg2bqxk5jhb3pgt9',callbackToolId:'tool_1501m3qwjjg3edv9wnzp784tk5j8',handoffToolId:'tool_8701m3qwknddeybasc3fdb5jd6a1',contractToolId:sellerContractToolId,fromPhone:'+14243948384'});
export type RecordedOutboundReadiness={status:'checked'|'partial'|'unavailable';mode:'read_only';checkedAt:string;agentId:string;branchId:string;expectedVersionId:string;observedVersionId:string|null;observedConfigHash:string|null;maxDurationSeconds:number|null;observedModelId:string|null;maxOutputTokens:number|null;draftExists:boolean|null;livePercentage:number|null;providerChecksPass:boolean;checks:Record<string,boolean>};
const t=recordedOutboundTarget,origin='https://api.elevenlabs.io',agentPath='/v1/convai/agents/'+t.agentId;
const paths=[agentPath+'?branch_id='+t.branchId,agentPath+'/branches?include_archived=true&limit=100','/v1/convai/settings',... [t.stopToolId,t.callbackToolId,t.handoffToolId,t.contractToolId].map(id=>'/v1/convai/tools/'+id)];
const record=(v:unknown)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const empty=(v:unknown)=>v==null||Array.isArray(v)&&v.length===0;
function stopMatches(raw:unknown){
 const r=object(raw),c=object(r.tool_config),a=object(c.api_schema),h=object(a.request_headers),b=object(a.request_body_schema),p=object(b.properties),id=object(p.recordingId),auth=object(h.Authorization);
 return r.id===t.stopToolId&&c.type==='webhook'&&c.name==='icash_stop_recording'&&a.url===recordingBaseUrl+'/stop'&&a.method==='POST'&&Object.keys(h).length===1&&Object.keys(auth).length===1&&auth.variable_name==='secret__icash_recording_stop_token'&&b.type==='object'&&JSON.stringify(b.required)==='["recordingId"]'&&Object.keys(p).length===1&&id.type==='string'&&id.dynamic_variable==='icash_recording_id'&&a.auth_connection==null&&empty(r.response_mocks);
}
/** Seven bounded GETs only; no database, dial, registration, settings writes or credential output. */
export async function readRecordedOutboundReadiness(env:{ELEVENLABS_API_KEY?:string;TWILIO_ACCOUNT_SID?:string},deps:{fetcher?:typeof fetch;signal?:AbortSignal;now?:()=>number}={}):Promise<RecordedOutboundReadiness>{
 const checkedAt=new Date((deps.now??Date.now)()).toISOString(),fetcher=deps.fetcher??fetch;
 async function read(path:string){
  if(!env.ELEVENLABS_API_KEY)throw Error('PROVIDER_READ_UNAVAILABLE');
  const url=origin+path,r=await fetcher(url,{method:'GET',headers:{'xi-api-key':env.ELEVENLABS_API_KEY,Accept:'application/json'},cache:'no-store',credentials:'omit',redirect:'error',signal:deps.signal?AbortSignal.any([deps.signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
  if(!r.ok||r.redirected||r.url&&r.url!==url||!/^application\/json(?:;|$)/i.test(r.headers.get('content-type')??'')){await r.body?.cancel().catch(()=>undefined);throw Error('PROVIDER_READ_UNAVAILABLE');}
  const value=JSON.parse((await boundedBytes(r,262144)).toString('utf8'));if(!record(value))throw Error('PROVIDER_READ_UNAVAILABLE');return value as Record<string,unknown>;
 }
 const receipts=await Promise.allSettled(paths.map(read)),value=(i:number)=>receipts[i].status==='fulfilled'?receipts[i].value:null;
 const a=object(value(0)),list=object(value(1)),rows=list.results,meta=object(list.meta);
 const complete=Array.isArray(rows)&&rows.length<100&&(meta.total===undefined||meta.total===rows.length)&&(list.next_cursor===undefined||list.next_cursor===null);
 const matches=complete?rows.map(object).filter(b=>b.id===t.branchId):[],b=matches.length===1?matches[0]:{};
 const identity=a.agent_id===t.agentId&&a.branch_id===t.branchId&&typeof a.version_id==='string'&&/^agtvrsn_[A-Za-z0-9]+$/.test(a.version_id)&&typeof a.main_branch_id==='string'&&/^agtbrch_[A-Za-z0-9]+$/.test(a.main_branch_id)&&a.main_branch_id!==t.branchId&&record(a.conversation_config)&&record(a.platform_settings);
 const hash=identity?sha(JSON.stringify(canonical({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null}))):null;
 const businessTools=inspectOutboundTools({required_tool_ids:[t.callbackToolId,t.handoffToolId]} as OutboundTemplate,[value(4),value(5)]);
 const exactBusinessTools=businessTools.toolDefinitionsVerified&&businessTools.tools[0]?.role==='callback'&&businessTools.tools[1]?.role==='handoff'&&[value(4),value(5)].every(raw=>{const h=object(object(object(raw).tool_config).api_schema).request_headers;return Object.keys(object(h)).length===1;});
 // This descriptor only compares the observed hash with the runtime validator.
 // Empty review dates and enabled:false make it unusable as a runtime approval.
 const observedReview:RecordingReview={...t,providerAccountSid:env.TWILIO_ACCOUNT_SID??'',enabled:false,reviewedAt:'',reviewedUntil:'',configHash:hash??'',toolIds:[t.callbackToolId,t.handoffToolId,t.stopToolId,t.contractToolId],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:'required-audio-30d-speech-v1'};
 const platform=object(a.platform_settings),checks={providerAccountConfigured:sid(env.TWILIO_ACCOUNT_SID,'AC'),canonicalIdentity:identity,expectedVersion:a.version_id===t.versionId,branchListComplete:complete,uniquePreparedBranch:matches.length===1,preparedBranchIdentity:b.agent_id===t.agentId,notArchived:b.is_archived===false,noDraft:b.draft_exists===false,zeroTraffic:b.current_live_percentage===0,noAssignedPhones:Array.isArray(a.phone_numbers)&&a.phone_numbers.length===0,canonicalRuntimeConfiguration:hash!==null&&recordingAgentMatches(observedReview,a),stopToolMatches:value(3)!==null&&stopMatches(value(3)),businessToolDefinitions:exactBusinessTools,contractToolMatches:value(6)!==null&&sellerContractToolMatches(value(6)),noAudioWebhookCopy:object(object(platform.workspace_overrides).webhooks).send_audio===false,workspacePostcallAbsent:value(2)!==null&&receptionWorkspacePostcallAbsent(value(2))};
 const seconds=object(a.conversation_config).conversation,max=object(seconds).max_duration_seconds,prompt=object(object(object(a.conversation_config).agent).prompt),model=prompt.llm,tokens=prompt.max_tokens,count=receipts.filter(x=>x.status==='fulfilled').length;
 return {status:count===paths.length?'checked':count===0?'unavailable':'partial',mode:'read_only',checkedAt,agentId:t.agentId,branchId:t.branchId,expectedVersionId:t.versionId,observedVersionId:identity?String(a.version_id):null,observedConfigHash:hash,maxDurationSeconds:typeof max==='number'&&Number.isSafeInteger(max)&&max>=0?max:null,observedModelId:typeof model==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(model)?model:null,maxOutputTokens:typeof tokens==='number'&&Number.isSafeInteger(tokens)&&tokens>=-1?tokens:null,draftExists:typeof b.draft_exists==='boolean'?b.draft_exists:null,livePercentage:typeof b.current_live_percentage==='number'&&Number.isFinite(b.current_live_percentage)?b.current_live_percentage:null,providerChecksPass:Object.values(checks).every(Boolean),checks};
}
