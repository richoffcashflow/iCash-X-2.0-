'use client';
import {useRef,useState} from 'react';
const checks:Record<string,string>={agentIdentityMatches:'Production agent identity',phoneIdentityMatches:'Outbound phone identity',phoneProviderTwilio:'Twilio phone provider',businessNumberMatches:'Business caller ID matches',configHashMatches:'Reviewed agent fingerprint matches',durationExactly600:'Provider duration is 600 seconds',durationMessageEmpty:'No extra duration-exit message',requiredToolsPresent:'Required tools attached',firstMessageOverrideEnabled:'Property greeting override allowed',promptOverrideEnabled:'Property prompt override allowed',durationOverrideEnabled:'Duration override allowed',reviewCurrent:'Configuration review is current'};
const toolChecks:Record<string,string>={identityMatches:'Reviewed tool identity',webhookType:'Server webhook tool',canonicalEndpoint:'Expected callback or handoff endpoint',postMethod:'POST method',scopedCallAuthorization:'Per-call authorization binding',providerConversationBinding:'Provider conversation binding',requiredBodyFields:'Required request fields',noAuthConnection:'No alternate authorization connection',noMockResults:'No mocked tool response'};
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function formatOutboundAudit(value:unknown):string[]{
 const data=obj(value);if(data.status!=='checked')return [];
 const lines=['Provider metadata was checked. This does not establish permission to contact anyone or prove a successful call.'];
 const show=(label:string,v:unknown)=>lines.push(label+': '+(v===true?'Pass':v===false?'Needs review':'Not verified'));
 show('Runtime configuration checks',data.runtimeConfigChecksPass);show('Tool definition checks',data.toolDefinitionsVerified);
 lines.push('Production template: '+(data.templateEnabled===true?'Enabled':data.templateEnabled===false?'Disabled':'Not verified'));
 for(const [key,label] of Object.entries(checks))show(label,obj(data.checks)[key]);
 const tools=Array.isArray(data.tools)?data.tools.slice(0,2):[];
 for(let i=0;i<tools.length;i++){const tool=obj(tools[i]),role=tool.role==='callback'?'Callback':tool.role==='handoff'?'Handoff':'Unrecognized';lines.push('Tool '+(i+1)+': '+role);for(const [key,label] of Object.entries(toolChecks))show(role+' · '+label,obj(tool.checks)[key]);}
 if(typeof data.maxDurationSeconds==='number'&&Number.isSafeInteger(data.maxDurationSeconds)&&data.maxDurationSeconds>=0&&data.maxDurationSeconds<=3600)lines.push('Provider duration limit: '+data.maxDurationSeconds+' seconds');
 if(data.maxOutputTokens===-1)lines.push('Provider response tokens: unlimited');else if(typeof data.maxOutputTokens==='number'&&Number.isSafeInteger(data.maxOutputTokens)&&data.maxOutputTokens>0&&data.maxOutputTokens<=1000000)lines.push('Provider response token limit: '+data.maxOutputTokens);
 if(typeof data.observedConfigHash==='string'&&/^[a-f0-9]{64}$/.test(data.observedConfigHash))lines.push('Observed configuration fingerprint: '+data.observedConfigHash);
 if(typeof data.checkedAt==='string'&&/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(data.checkedAt)&&Number.isFinite(Date.parse(data.checkedAt)))lines.push('Checked at: '+data.checkedAt);
 lines.push('Live call verification: not tested. No call was started by this check.');return lines;
}
export async function loadOutboundAudit(fetcher:typeof fetch=fetch){
 const response=await fetcher('/api/owner-outbound-readiness',{method:'GET',cache:'no-store',credentials:'same-origin'});
 if(response.status===401)return {lines:[],message:'Sign in with the existing owner account, then try this check again.'};
 if(response.status===403)return {lines:[],message:'This diagnostic is available only to the configured owner.'};
 if(!response.ok)return {lines:[],message:'Outbound readiness could not be checked. No provider result is verified.'};
 const lines=formatOutboundAudit(await response.json());return {lines,message:lines.length?'Read-only provider check completed.':'Outbound readiness could not be checked. No provider result is verified.'};
}
export default function OutboundReadiness(){
 const [busy,setBusy]=useState(false),[lines,setLines]=useState<string[]>([]),[message,setMessage]=useState('');const running=useRef(false);
 async function check(){if(running.current)return;running.current=true;setBusy(true);setLines([]);setMessage('');try{const result=await loadOutboundAudit();setLines(result.lines);setMessage(result.message);}catch{setLines([]);setMessage('Outbound readiness could not be checked. No provider result is verified.');}finally{running.current=false;setBusy(false);}}
 return <section aria-label="Outbound voice readiness" aria-busy={busy} style={{borderTop:'1px solid #bbb',marginTop:32,paddingTop:24}}><h2>Outbound voice readiness</h2><p>Read the production agent, outbound phone and callback tools. This check does not start calls, enable service, change prices or spend credits.</p><button type="button" disabled={busy} onClick={check}>{busy?'Checking outbound readiness…':'Check outbound readiness (read only)'}</button>{message&&<p role="status">{message}</p>}{lines.length>0&&<ul aria-label="Outbound diagnostic results">{lines.map((line,index)=><li key={index}>{line}</li>)}</ul>}</section>;
}
