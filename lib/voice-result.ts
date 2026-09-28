export type VoiceConversation={conversation_id:string;agent_id:string;status:string;has_user_audio?:boolean;has_response_audio?:boolean;transcript?:{role:string;message?:string|null;time_in_call_secs?:number}[];analysis?:{transcript_summary?:string;data_collection_results?:Record<string,{value?:unknown}>};metadata?:{start_time_unix_secs?:number;call_duration_secs?:number;cost?:number;cost_fiat?:number}};
export function voiceResult(c:VoiceConversation, expected:{conversationId:string;agentId:string}, now=Date.now()) {
 if(c.conversation_id!==expected.conversationId||c.agent_id!==expected.agentId)throw new Error('VOICE_ID_MISMATCH');
 if(c.status!=='done'||!c.analysis||!c.analysis.transcript_summary?.trim())return null;
 const transcript=(c.transcript??[]).filter(t=>['agent','user'].includes(t.role)&&typeof t.message==='string').map(t=>({role:t.role,message:t.message!,seconds:t.time_in_call_secs??0}));
 const fields=c.analysis.data_collection_results??{};
 const value=(name:string)=>fields[name]?.value;
 let callbackStatus='not_requested';let dueAt:string|null=null;let timezone:string|null=null;
 if(value('opted_out')===true)callbackStatus='blocked_opt_out';
 else if(value('callback_requested')===true){
  callbackStatus='needs_confirmation';
  const at=value('callback_at'),zone=value('callback_timezone'),quote=value('callback_quote');
  if(value('callback_confirmed')===true&&typeof at==='string'&&typeof zone==='string'&&typeof quote==='string'&&quote.trim().length>=3&&transcript.some(t=>t.role==='user'&&t.message.includes(quote))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(at)){
   const stamp=Date.parse(at);
   try{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(stamp));
    const p=Object.fromEntries(parts.map(v=>[v.type,v.value]));
    const local=`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
    if(stamp>now&&stamp<=now+90*86400000&&local===at.slice(0,19)){callbackStatus='scheduled_test';dueAt=new Date(stamp).toISOString();timezone=zone;}
   }catch{/* Invalid timezone/date stays unconfirmed. */}
  }
 }
 return {summary:c.analysis.transcript_summary?.trim()||'No summary was returned.',transcript,callbackStatus,dueAt,timezone,callbackQuote:typeof value('callback_quote')==='string'?value('callback_quote'):null,durationSeconds:c.metadata?.call_duration_secs??null,providerCreditUnits:c.metadata?.cost??null,providerCostUsd:c.metadata?.cost_fiat??null,userAudio:c.has_user_audio===true,responseAudio:c.has_response_audio===true,testOnly:true as const,sellerCallingEnabled:false as const};
}
