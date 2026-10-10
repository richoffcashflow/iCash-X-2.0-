import {canonical,object,sha} from '../lib/required-call-recording.ts';

const fingerprint=value=>sha(JSON.stringify(canonical(value)));
const schemaKeys=new Set(('main_branch_id agent_id branch_id version_id conversation_config platform_settings workflow procedures agent prompt tools tool_ids built_in_tools mcp_server_ids native_mcp_server_ids knowledge_base rag custom_llm asr tts conversation turn language_presets first_message language max_tokens llm temperature voice_id model_id stability speed similarity_boost optimize_streaming_latency agent_output_audio_format user_input_audio_format max_duration_seconds privacy record_voice auth enable_auth call_limits agent_concurrency_limit bursting_enabled queueing_config enabled overrides conversation_config_override workspace_overrides webhooks events post_call_webhook_id send_audio guardrails version focus custom config configs is_enabled type name params system_tool_type api_schema request_headers request_body_schema properties required dynamic_variables dynamic_variable_placeholders evaluation criteria data_collection retention_days conversation_retention_days delete_transcript_and_pii audio_save_locally use_zero_retention_mode soft_timeout turn_timeout turn_eagerness spelling_patience silence_end_call_timeout').split(' '));
const safePath=path=>path.map(part=>typeof part==='number'?`[${part}]`:schemaKeys.has(part)?part:'[unrecognized_key]').join('.');
const shape=value=>value===null?'null':Array.isArray(value)?`array:${value.length}`:typeof value;
const maxAttempts=16384;
for(const key of ['description','dynamic_variable','constant_value','enum','items','allowed_values','allowed_values_dynamic_variable','is_system_provided','is_omitted'])schemaKeys.add(key);

/** Fixed schema paths and primitive values only. In particular, never walk
 * prompts, dynamic variables, headers, webhook payloads or provider key names. */
export function receptionFingerprintSettings(input){
 const raw=object(input),paths=[
  ...['auth.enable_auth','auth.allowlist','privacy.record_voice','privacy.retention_days','privacy.conversation_retention_days','privacy.delete_transcript_and_pii','privacy.audio_save_locally','privacy.apply_to_existing_conversations','privacy.use_zero_retention_mode','call_limits.agent_concurrency_limit','call_limits.daily_limit','call_limits.bursting_enabled','queueing_config.enabled','queueing_config.wait_timeout_seconds'].map(p=>'platform_settings.'+p),
  ...['turn.turn_timeout','turn.initial_wait_time','turn.silence_end_call_timeout','turn.speculative_turn','turn.retranscribe_on_turn_timeout','turn.transcribe_on_disabled_interruptions','turn.soft_timeout_config.timeout_seconds','turn.soft_timeout_config.max_soft_timeouts_per_generation','turn.soft_timeout_config.disable_until_first_user_message','tts.stability','tts.speed','tts.similarity_boost','tts.optimize_streaming_latency','agent.prompt.temperature','agent.prompt.max_tokens','agent.prompt.thinking_budget','agent.prompt.cascade_timeout_seconds'].map(p=>'conversation_config.'+p),
 ];
 return paths.map(path=>{
  const value=path.split('.').reduce((v,key)=>object(v)[key],raw);
  return {path,value:value===undefined?'absent':value===null?null:typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)?value:Array.isArray(value)?`array:${value.length}`:typeof value==='object'?'object':'redacted'};
 });
}

function* permutations(values){
 if(values.length<2){yield values;return;}
 for(let i=0;i<values.length;i++)for(const rest of permutations(values.filter((_,j)=>i!==j)))yield [values[i],...rest];
}

/** Failure diagnostics only. Never authorizes a configuration, changes the
 * expected hash, writes to a provider, or returns provider values. An exact
 * match identifies a hypothesis to review; it does not make that change safe. */
export function diagnoseReceptionFingerprint(input,expectedHash){
 const raw=object(input);
 const snapshot=structuredClone({main_branch_id:raw.main_branch_id,agent_id:raw.agent_id,branch_id:raw.branch_id,version_id:raw.version_id,conversation_config:raw.conversation_config,platform_settings:raw.platform_settings,workflow:raw.workflow??null,procedures:raw.procedures??null});
 let attempts=0;
 const result={matched:false,exact:fingerprint(snapshot)===expectedHash,attempts:0,truncated:false,changes:[]};
 if(result.exact||!/^[a-f0-9]{64}$/.test(expectedHash))return result;
 const arrays=[],fields=[];
 function visit(value,path=[]){
  if(path.length>24||fields.length>=1024){result.truncated=true;return;}
  if(Array.isArray(value)){
   if(value.length>1&&value.length<=5)arrays.push({value,path});
   value.slice(0,32).forEach((item,index)=>visit(item,[...path,index]));
  }else if(value&&typeof value==='object'){
   for(const [key,child] of Object.entries(value)){
    if(fields.length>=1024){result.truncated=true;break;}
    fields.push({parent:value,key,value:child,path:[...path,key]});visit(child,[...path,key]);
   }
  }
 }
 visit(snapshot);
 function check(changes){
  if(attempts>=maxAttempts){result.truncated=true;return false;}
  attempts++;
  if(fingerprint(snapshot)!==expectedHash)return false;
  result.matched=true;result.changes=changes;return true;
 }
 // Provider serializers can introduce more than one optional field together.
 // Check pairs of neutral key groups against the complete original hash.
 // This is diagnostic reconstruction only, not a runtime normalization rule.
 const neutralGroups=new Map();
 for(const field of fields){
  if(!(field.value===null||field.value===false||field.value===''||Array.isArray(field.value)&&field.value.length===0))continue;
  const key=field.key+':'+shape(field.value),group=neutralGroups.get(key)??[];
  group.push(field);neutralGroups.set(key,group);
 }
 const neutral=[...neutralGroups.values()];
 for(let i=0;i<neutral.length;i++)for(let j=i+1;j<neutral.length;j++){
  const group=[...neutral[i],...neutral[j]];
  for(const field of group)delete field.parent[field.key];
  const found=check(group.map(field=>({kind:'remove_neutral_fields',path:safePath(field.path),observedShape:shape(field.value)})));
  for(const field of group)field.parent[field.key]=field.value;
  if(found)return {...result,attempts};
  if(attempts>=maxAttempts)return {...result,attempts,truncated:true};
 }
 // Numeric settings remain version-external in some provider responses.
 // Test bounded historical/default values without changing any live setting.
 // Exact reconstruction is evidence only, never automatic approval.
 const numericDefaults=[...new Set([...Array.from({length:33},(_,i)=>i),.1,.2,.25,.3,.4,.5,.6,.7,.75,.8,.9,45,60,64,90,100,120,128,150,180,200,256,300,500,512,600,1000])];
 for(const field of fields){
  if(typeof field.value!=='number'||!Number.isFinite(field.value))continue;
  for(const replacement of numericDefaults){
   if(replacement===field.value)continue;
   field.parent[field.key]=replacement;
   const found=check([{kind:'restore_numeric_setting',path:safePath(field.path),restoredValue:replacement}]);
   field.parent[field.key]=field.value;
   if(found)return {...result,attempts};
   if(attempts>=maxAttempts)return {...result,attempts,truncated:true};
  }
 }
 // Array order can change in a read response without changing the version.
 // This search is deliberately broader than any eventual compatibility rule.
 for(const entry of arrays){
  const original=[...entry.value];
  for(const order of permutations(original.map((_,index)=>index))){
   if(order.every((index,position)=>index===position))continue;
   entry.value.splice(0,entry.value.length,...order.map(index=>original[index]));
   const found=check([{kind:'array_order',path:safePath(entry.path),count:original.length,order}]);
   entry.value.splice(0,entry.value.length,...original);
   if(found)return {...result,attempts};
   if(attempts>=maxAttempts)return {...result,attempts,truncated:true};
  }
 }
 // Tool IDs and expanded tools may both be returned in a different order.
 const toolArrays=arrays.filter(entry=>['conversation_config.agent.prompt.tools','conversation_config.agent.prompt.tool_ids'].includes(entry.path.join('.')));
 if(toolArrays.length===2){
  const [left,right]=toolArrays,one=[...left.value],two=[...right.value];
  for(const a of permutations(one.map((_,i)=>i)))for(const b of permutations(two.map((_,i)=>i))){
   left.value.splice(0,left.value.length,...a.map(i=>one[i]));right.value.splice(0,right.value.length,...b.map(i=>two[i]));
   const found=check([{kind:'array_order',path:safePath(left.path),count:one.length,order:a},{kind:'array_order',path:safePath(right.path),count:two.length,order:b}]);
   left.value.splice(0,left.value.length,...one);right.value.splice(0,right.value.length,...two);
   if(found)return {...result,attempts};
   if(attempts>=maxAttempts)return {...result,attempts,truncated:true};
  }
 }
 // Read responses can materialize optional expanded tool definitions beside
 // the authoritative IDs. Identify that representation by reconstructing the
 // entire prior hash; never infer authorization from a tool name or ID here.
 const expandedTools=arrays.find(entry=>entry.path.join('.')==='conversation_config.agent.prompt.tools');
 if(expandedTools){
  const original=[...expandedTools.value];
  for(let mask=0;mask<(1<<original.length)-1;mask++){
   const indices=original.map((_,i)=>i).filter(i=>mask&(1<<i));
   for(const order of permutations(indices)){
    expandedTools.value.splice(0,expandedTools.value.length,...order.map(i=>original[i]));
    const found=check([{kind:'expanded_tool_projection',path:safePath(expandedTools.path),observedCount:original.length,retainedIndices:order}]);
    expandedTools.value.splice(0,expandedTools.value.length,...original);
    if(found)return {...result,attempts};
   }
  }
 }
 // Schema serializers can add the same neutral default to every tool field.
 // Grouped hypotheses still require reconstruction of the complete old hash.
 const groups=new Map();
 for(const field of fields){const group=groups.get(field.key)??[];group.push(field);groups.set(field.key,group);}
 for(const group of groups.values()){
  if(group.length<2)continue;
  for(const kind of ['remove_field','restore_null','restore_empty_string','restore_empty_array','restore_empty_object','restore_false','restore_true']){
   const replacement=kind==='restore_null'?null:kind==='restore_empty_string'?'':kind==='restore_empty_array'?[]:kind==='restore_empty_object'?{}:kind==='restore_false'?false:true;
   for(const field of group){if(kind==='remove_field')delete field.parent[field.key];else field.parent[field.key]=replacement;}
   const found=check(group.map(field=>({kind,path:safePath(field.path),observedShape:shape(field.value)})));
   for(const field of group)field.parent[field.key]=field.value;
   if(found)return {...result,attempts};
   if(attempts>=maxAttempts)return {...result,attempts,truncated:true};
  }
 }
 // Identify a single default/empty representation change. These diagnostic
 // hypotheses do not become permitted differences in the runtime inspector.
 for(const field of fields){
  const kinds=['remove_field','restore_null','restore_empty_array','restore_empty_object',...(typeof field.value==='boolean'?['restore_false','restore_true']:typeof field.value==='string'?['restore_empty_string']:[])];
  for(const kind of kinds){
   const replacement=kind==='restore_null'?null:kind==='restore_empty_string'?'':kind==='restore_empty_array'?[]:kind==='restore_empty_object'?{}:kind==='restore_false'?false:true;
   if(kind==='remove_field')delete field.parent[field.key];else field.parent[field.key]=replacement;
   const found=check([{kind,path:safePath(field.path),observedShape:shape(field.value)}]);
   field.parent[field.key]=field.value;
   if(found)return {...result,attempts};
   if(attempts>=maxAttempts)return {...result,attempts,truncated:true};
  }
 }
 return {...result,attempts};
}
