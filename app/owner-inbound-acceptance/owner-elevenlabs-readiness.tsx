'use client';
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';

// Validate every displayed value before keeping a response in component state.
// Unknown fields are stripped; unknown model IDs and arbitrary URLs are rejected.
const publicModels=new Set('gpt-4o-mini gpt-4o gpt-4 gpt-4-turbo gpt-4.1 gpt-4.1-mini gpt-4.1-nano gpt-5 gpt-5.1 gpt-5.2 gpt-5.2-chat-latest gpt-5.4 gpt-5.4-mini gpt-5.4-nano gpt-5.5 gpt-5.6-sol gpt-5.6-terra gpt-5.6-luna gpt-6-astra gpt-6-sol gpt-6-luna gpt-5-mini gpt-5-nano gpt-3.5-turbo gemini-1.5-pro gemini-1.5-flash gemini-2.0-flash gemini-2.0-flash-lite gemini-2.5-flash-lite gemini-2.5-flash gemini-3-pro-preview gemini-3-flash-preview gemini-3.1-pro-preview gemini-3.1-flash-lite-preview gemini-3.1-flash-lite gemini-3.5-flash gemini-3.5-flash-lite gemini-3.6-flash gemini-3.7-flash gemini-3.8-flash claude-sonnet-4-5 claude-opus-4-7 claude-opus-4-8 claude-opus-5 claude-opus-5-5 claude-sonnet-4-6 claude-sonnet-5 claude-sonnet-5-5 claude-sonnet-4 claude-haiku-4-5 claude-3-7-sonnet claude-3-5-sonnet claude-3-5-sonnet-v1 claude-3-haiku grok-beta custom-llm qwen3-4b qwen3-30b-a3b qwen36-35b-a3b qwen35-397b-a17b gpt-oss-20b gpt-oss-120b glm-45-air-fp8 glm-52 deepseek-v41-flash gemini-2.5-flash-preview-09-2025 gemini-2.5-flash-lite-preview-09-2025 gemini-2.5-flash-preview-05-20 gemini-2.5-flash-preview-04-17 gemini-2.5-flash-lite-preview-06-17 gemini-2.0-flash-lite-001 gemini-2.0-flash-001 gemini-1.5-flash-002 gemini-1.5-flash-001 gemini-1.5-pro-002 gemini-1.5-pro-001 claude-sonnet-4@20250514 claude-sonnet-4-5@20250929 claude-haiku-4-5@20251001 claude-3-7-sonnet@20250219 claude-3-5-sonnet@20240620 claude-3-5-sonnet-v2@20241022 claude-3-haiku@20240307 gpt-5-2025-08-07 gpt-5.1-2025-11-13 gpt-5.2-2025-12-11 gpt-5.4-2026-03-05 gpt-5.4-mini-2026-03-17 gpt-5.4-nano-2026-03-17 gpt-5.5-2026-04-23 gpt-5-mini-2025-08-07 gpt-5-nano-2025-08-07 gpt-4.1-2025-04-14 gpt-4.1-mini-2025-04-14 gpt-4.1-nano-2025-04-14 gpt-4o-mini-2024-07-18 gpt-4o-2024-11-20 gpt-4o-2024-08-06 gpt-4o-2024-05-13 gpt-4-0613 gpt-4-0314 gpt-4-turbo-2024-04-09 gpt-3.5-turbo-0125 gpt-3.5-turbo-1106 watt-tool-8b watt-tool-70b'.split(' '));
const nullableBoolean=z.boolean().nullable();
const nullableInteger=(minimum=0)=>z.number().int().safe().min(minimum).nullable();
const providerStatus=z.enum(['checked','provider_auth_failed','provider_access_denied','provider_unavailable','provider_receipt_invalid','target_mismatch']);
const webhookAuthenticationSchema=z.object({
 overrideConfigured:nullableBoolean,
 webhookUrl:z.enum(['https://www.geticashx.com/api/internal/voice/inbound','https://geticashx.com/api/internal/voice/inbound']).nullable(),
 webhookUrlMatchesCanonical:nullableBoolean,authorizationHeaderPresent:nullableBoolean,authorizationHeaderUnique:nullableBoolean,authorizationBearerScheme:nullableBoolean,
 authorizationValueComparable:z.boolean(),serverWebhookSecretConfigured:z.boolean(),authorizationMatchesServerSecret:nullableBoolean,workspaceFallback:z.literal('not_read'),
});
const readinessSchema=z.object({
 status:z.enum(['checked','partial']),region:z.literal('us'),checkedAt:z.string().datetime(),callVerification:z.literal('not_tested'),
 agent:z.object({
  status:providerStatus,model:z.string().refine(value=>publicModels.has(value)).nullable(),
  maxTokens:nullableInteger(-1),maxTokensStatus:z.enum(['bounded','unlimited','not_returned','unknown']),
  maxDurationSeconds:nullableInteger(),queueEnabled:nullableBoolean,queueWaitTimeoutSeconds:nullableInteger(),burstingEnabled:nullableBoolean,
  privacy:z.object({recordVoice:nullableBoolean,retentionDays:nullableInteger(-1),deleteTranscriptAndPii:nullableBoolean,deleteAudio:nullableBoolean,zeroRetentionMode:nullableBoolean}),
  authenticationEnabled:nullableBoolean,initiationWebhookEnabled:nullableBoolean,
  webhookAuthentication:webhookAuthenticationSchema.extend({scope:z.literal('private_test_branch_override_only')}),
 }).refine(agent=>agent.maxTokensStatus==='bounded'?agent.maxTokens!==null&&agent.maxTokens>0:agent.maxTokensStatus==='unlimited'?agent.maxTokens===-1:agent.maxTokens===null),
 branch:z.object({status:providerStatus,archived:nullableBoolean,liveTrafficPercent:z.number().finite().min(0).max(100).nullable()}),
 incomingDefault:z.object({status:providerStatus,assignedPhoneBranchMatches:nullableBoolean,initiationWebhookEnabled:nullableBoolean,webhookAuthentication:webhookAuthenticationSchema.extend({scope:z.literal('default_agent_override_only')}),requestAuthenticationVerified:z.literal(false)}),
 phone:z.object({status:providerStatus,assignedAgentMatches:nullableBoolean,assignedBranchMatches:nullableBoolean}),
});
type PendingRead={controller:AbortController;timer:ReturnType<typeof setTimeout>|null};

const yesNo=(value:boolean|null)=>value===null?'Unknown':value?'Yes':'No';
const statusLabel=(value:string)=>value.replaceAll('_',' ');
function webhookAuthenticationDetails(auth:z.infer<typeof webhookAuthenticationSchema>){
 return <>
    <dl>
     <dt>Agent webhook override configured</dt><dd>{yesNo(auth.overrideConfigured)}</dd>
     <dt>Recognized application webhook URL</dt><dd>{auth.webhookUrl??'Not returned or outside the expected application URLs'}</dd>
     <dt>Webhook uses the canonical www URL</dt><dd>{yesNo(auth.webhookUrlMatchesCanonical)}</dd>
     <dt>Authorization header present in override</dt><dd>{yesNo(auth.authorizationHeaderPresent)}</dd>
     <dt>Exactly one Authorization header</dt><dd>{yesNo(auth.authorizationHeaderUnique)}</dd>
     <dt>Authorization uses the expected Bearer prefix</dt><dd>{yesNo(auth.authorizationBearerScheme)}</dd>
     <dt>Authorization value directly comparable</dt><dd>{yesNo(auth.authorizationValueComparable)}</dd>
     <dt>Server webhook secret configured</dt><dd>{yesNo(auth.serverWebhookSecretConfigured)}</dd>
     <dt>Configured Authorization equals the server secret</dt><dd>{yesNo(auth.authorizationMatchesServerSecret)}</dd>
    </dl>
  <p>This compares configuration only. It does not prove which Authorization header was delivered or authenticate an incoming request. Workspace fallback settings are unknown. A hidden value or secret reference cannot prove equality.</p>
 </>;
}
export default function OwnerElevenLabsReadinessPanel(){
 const [data,setData]=useState<z.infer<typeof readinessSchema>|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const request=useRef<PendingRead|null>(null);
 useEffect(()=>()=>{
  const active=request.current;request.current=null;
  if(active){if(active.timer!==null)clearTimeout(active.timer);active.controller.abort();}
 },[]);
 async function refresh(){
  if(request.current)return;
  const active:PendingRead={controller:new AbortController(),timer:null};
  request.current=active;setBusy(true);setData(null);setMessage('');
  active.timer=setTimeout(()=>{
   if(request.current!==active)return;
   request.current=null;active.controller.abort();setBusy(false);setData(null);
   setMessage('The settings check timed out. Leave the audio test on hold and try checking again.');
  },65000);
  try{
   const response=await fetch('/api/owner-inbound-acceptance/elevenlabs',{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',referrerPolicy:'no-referrer',signal:active.controller.signal});
   if(request.current!==active)return;
   if(!response.ok){setMessage(response.status===401?'Sign in to check the owner settings.':response.status===403?'These settings are available only to the configured owner.':'Settings are unavailable. Leave the audio test on hold.');return;}
   const result=readinessSchema.safeParse(await response.json());
   if(request.current!==active)return;
   if(!result.success)throw Error();
   setData(result.data);
  }catch{if(request.current===active)setMessage('Settings are unavailable. Leave the audio test on hold.');}
  finally{if(request.current===active){if(active.timer!==null)clearTimeout(active.timer);request.current=null;setBusy(false);}}
 }
 const auth=data?.agent.webhookAuthentication;
 return <section aria-label="ElevenLabs owner settings" style={{maxWidth:650,margin:'2rem auto',padding:'1.5rem',lineHeight:1.6,border:'1px solid currentColor',borderRadius:12}}>
  <h2>ElevenLabs owner settings</h2>
  <p>Read the default incoming webhook, private test branch, and incoming phone settings. This check does not place a call or change settings.</p>
  <button type="button" disabled={busy} onClick={()=>void refresh()}>{busy?'Checking settings…':'Check ElevenLabs settings'}</button>
  <p role="status">{busy?'Reading settings…':data?`Settings ${statusLabel(data.status)}. This read does not verify audio.`:'Settings have not been checked.'}</p>
  {message&&<p role="alert">{message}</p>}
  {data&&<>
   <p>Provider region: US · Checked {new Date(data.checkedAt).toLocaleString('en-US',{hour12:true})}</p>
   <h3>Default incoming webhook authentication</h3>
   <dl>
    <dt>Default agent settings</dt><dd>{statusLabel(data.incomingDefault.status)}</dd>
    <dt>Phone assignment matches the default configuration branch</dt><dd>{yesNo(data.incomingDefault.assignedPhoneBranchMatches)}</dd>
    <dt>Default call initiation webhook enabled</dt><dd>{yesNo(data.incomingDefault.initiationWebhookEnabled)}</dd>
    <dt>Incoming request authentication verified by this read</dt><dd>No</dd>
   </dl>
   {webhookAuthenticationDetails(data.incomingDefault.webhookAuthentication)}
   <h3>Private test branch settings</h3>
   <dl>
    <dt>Agent settings</dt><dd>{statusLabel(data.agent.status)}</dd>
    <dt>Conversation model</dt><dd>{data.agent.model??'Unknown'}</dd>
    <dt>Model token limit</dt><dd>{data.agent.maxTokensStatus==='bounded'?data.agent.maxTokens:data.agent.maxTokensStatus==='unlimited'?'Unlimited':data.agent.maxTokensStatus==='not_returned'?'Not returned by provider':'Unknown'}</dd>
    <dt>Maximum conversation length</dt><dd>{data.agent.maxDurationSeconds===null?'Unknown':`${data.agent.maxDurationSeconds} seconds`}</dd>
    <dt>Caller queue enabled</dt><dd>{yesNo(data.agent.queueEnabled)}</dd>
    <dt>Maximum queue wait</dt><dd>{data.agent.queueWaitTimeoutSeconds===null?'Unknown':`${data.agent.queueWaitTimeoutSeconds} seconds`}</dd>
    <dt>Burst pricing enabled</dt><dd>{yesNo(data.agent.burstingEnabled)}</dd>
    <dt>Voice recording enabled</dt><dd>{yesNo(data.agent.privacy.recordVoice)}</dd>
    <dt>Retention</dt><dd>{data.agent.privacy.retentionDays===null?'Unknown':data.agent.privacy.retentionDays===-1?'No retention limit':`${data.agent.privacy.retentionDays} days`}</dd>
    <dt>Delete transcript and personal information</dt><dd>{yesNo(data.agent.privacy.deleteTranscriptAndPii)}</dd>
    <dt>Delete audio</dt><dd>{yesNo(data.agent.privacy.deleteAudio)}</dd>
    <dt>Zero retention mode</dt><dd>{yesNo(data.agent.privacy.zeroRetentionMode)}</dd>
    <dt>Conversation authentication enabled</dt><dd>{yesNo(data.agent.authenticationEnabled)}</dd>
    <dt>Call initiation webhook enabled</dt><dd>{yesNo(data.agent.initiationWebhookEnabled)}</dd>
    <dt>Branch settings</dt><dd>{statusLabel(data.branch.status)}</dd>
    <dt>Branch archived</dt><dd>{yesNo(data.branch.archived)}</dd>
    <dt>Branch live traffic</dt><dd>{data.branch.liveTrafficPercent===null?'Unknown':`${data.branch.liveTrafficPercent}%`}</dd>
    <dt>Incoming phone settings</dt><dd>{statusLabel(data.phone.status)}</dd>
    <dt>Phone assigned to the expected agent</dt><dd>{yesNo(data.phone.assignedAgentMatches)}</dd>
    <dt>Phone assigned to the private test branch</dt><dd>{yesNo(data.phone.assignedBranchMatches)}</dd>
   </dl>
   {auth&&<><h3>Private test branch webhook authentication</h3>{webhookAuthenticationDetails(auth)}</>}
   <p>Unknown means the provider did not supply usable evidence. These settings alone do not verify call routing, audio, or the spending cap.</p>
  </>}
 </section>;
}
