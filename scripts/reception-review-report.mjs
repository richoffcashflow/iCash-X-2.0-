import {object} from '../lib/required-call-recording.ts';

/** Private review evidence only. Never used to authorize a call or deployment.
 * Preserve configuration settings, but remove credentials, prompts, and dynamic
 * values. The existing inspectors separately verify the prompt and tool schema. */
export function receptionReviewReport(input,secrets=[]){
 const a=object(input),snapshot={main_branch_id:a.main_branch_id,agent_id:a.agent_id,branch_id:a.branch_id,version_id:a.version_id,conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null};
 const hidden=secrets.filter(v=>typeof v==='string'&&v.length>=8);
 const clean=s=>hidden.reduce((text,value)=>text.replaceAll(value,'[redacted]'),s);
 function redact(value,path=[]){
  const key=path.at(-1)??'';
  if(/authorization|password|credential|api[_-]?key|secret|access_token|refresh_token|request_headers/i.test(key)||key==='dynamic_variable_placeholders'||path.join('.')==='conversation_config.agent.prompt.prompt')return '[redacted; separately checked]';
  if(Array.isArray(value))return value.map((entry,i)=>redact(entry,[...path,String(i)]));
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[clean(k),redact(v,[...path,k])]));
  return typeof value==='string'?clean(value):value;
 }
 const report=redact(snapshot);
 if(JSON.stringify(report).length>200000)throw Error('RECEPTION_REVIEW_REPORT_TOO_LARGE');
 return report;
}
