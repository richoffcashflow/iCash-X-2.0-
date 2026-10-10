import {canonical,object,sha} from '../lib/required-call-recording.ts';

const fingerprint=value=>sha(JSON.stringify(canonical(value)));
const schemaKeys=new Set(('main_branch_id agent_id branch_id version_id conversation_config platform_settings workflow procedures agent prompt tools tool_ids built_in_tools mcp_server_ids native_mcp_server_ids knowledge_base rag custom_llm asr tts conversation turn language_presets first_message language max_tokens llm temperature voice_id model_id stability speed similarity_boost optimize_streaming_latency agent_output_audio_format user_input_audio_format max_duration_seconds privacy record_voice auth enable_auth call_limits agent_concurrency_limit bursting_enabled queueing_config enabled overrides conversation_config_override workspace_overrides webhooks events post_call_webhook_id send_audio guardrails version focus custom config configs is_enabled type name params system_tool_type api_schema request_headers request_body_schema properties required dynamic_variables dynamic_variable_placeholders evaluation criteria data_collection retention_days conversation_retention_days delete_transcript_and_pii audio_save_locally use_zero_retention_mode soft_timeout turn_timeout turn_eagerness spelling_patience silence_end_call_timeout').split(' '));
const safePath=path=>path.map(part=>typeof part==='number'?`[${part}]`:schemaKeys.has(part)?part:'[unrecognized_key]').join('.');
const shape=value=>value===null?'null':Array.isArray(value)?`array:${value.length}`:typeof value;
for(const key of ['description','dynamic_variable','constant_value','enum','items','allowed_values','allowed_values_dynamic_variable','is_system_provided','is_omitted'])schemaKeys.add(key);

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
  if(attempts>=4096){result.truncated=true;return false;}
  attempts++;
  if(fingerprint(snapshot)!==expectedHash)return false;
  result.matched=true;result.changes=changes;return true;
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
   if(attempts>=4096)return {...result,attempts,truncated:true};
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
   if(attempts>=4096)return {...result,attempts,truncated:true};
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
   if(attempts>=4096)return {...result,attempts,truncated:true};
  }
 }
 // Identify a single default/empty representation change. These diagnostic
 // hypotheses do not become permitted differences in the runtime inspector.
 for(const field of fields){
  const kinds=['remove_field','restore_null',...(Array.isArray(field.value)?['restore_empty_array']:field.value&&typeof field.value==='object'?['restore_empty_object']:typeof field.value==='boolean'?['restore_false','restore_true']:typeof field.value==='string'?['restore_empty_string']:[])];
  for(const kind of kinds){
   const replacement=kind==='restore_null'?null:kind==='restore_empty_string'?'':kind==='restore_empty_array'?[]:kind==='restore_empty_object'?{}:kind==='restore_false'?false:true;
   if(kind==='remove_field')delete field.parent[field.key];else field.parent[field.key]=replacement;
   const found=check([{kind,path:safePath(field.path),observedShape:shape(field.value)}]);
   field.parent[field.key]=field.value;
   if(found)return {...result,attempts};
   if(attempts>=4096)return {...result,attempts,truncated:true};
  }
 }
 return {...result,attempts};
}
