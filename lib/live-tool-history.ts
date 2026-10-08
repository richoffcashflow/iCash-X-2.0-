import {object} from './required-call-recording.ts';

/** Provider-injected system__conversation_history on the authenticated,
 * call-bound webhook. Never accept an LLM-authored transcript field. The reviewed
 * tool schema fixes this property's source to the provider's reserved variable. */
export function liveToolHistory(raw:unknown){
 if(raw===undefined)return null; // Older reviewed branches use provider GET.
 if(typeof raw!=='string'||raw.length>196608)throw Error('invalid_call_history');
 let value:Record<string,unknown>;try{value=object(JSON.parse(raw));}catch{throw Error('invalid_call_history');}
 if(value['x-elevenlabs-history']!==true||!Array.isArray(value.entries)||value.entries.length>500)throw Error('invalid_call_history');
 const transcript=value.entries.map(object).flatMap<Record<string,unknown>>(turn=>{
  if(!['agent','user','tool'].includes(String(turn.role)))return [];
  if(typeof turn.message==='string'){
   if(turn.message.length>12000)throw Error('invalid_call_history');
   return [{role:turn.role,message:turn.message}];
  }
  // Tool results locate the last exact quote revision; they never set prices.
  if(Array.isArray(turn.tool_results))return [{role:turn.role,message:null,tool_results:turn.tool_results}];
  return [];
 });
 return {transcript};
}
