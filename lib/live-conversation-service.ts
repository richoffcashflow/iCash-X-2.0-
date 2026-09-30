import {db as database} from '@/lib/stripe-test';
import {elevenRequest} from '@/lib/elevenlabs';
import {readVoiceUsagePolicies,settleBoundVoiceUsage} from './voice-usage-service.ts';
import {liveConversationResult} from './deal-conversation.ts';
import type {VoiceConversation} from './voice-result.ts';
export async function reconcileLiveConversation(accountId:string,callId:string,signal?:AbortSignal){
 const db:typeof database=(path,method,body)=>{signal?.throwIfAborted();return database(path,method,body,signal);};
 const [call]=await db<{conversation_id:string;agent_id:string;party:'seller'|'buyer';state:string;operation_key:string}[]>(`icash_live_conversations?id=eq.${callId}&account_id=eq.${accountId}&select=conversation_id,agent_id,party,state,operation_key`);
 if(!call)return {status:'not_found'};
 const settle=()=>settleBoundVoiceUsage(db,accountId,callId,readVoiceUsagePolicies(process.env.VOICE_USAGE_POLICIES_JSON));
 if(call.state==='complete'){
  const billing=await settle();
  if(billing.status!=='held'||!['provider_receipt_missing','duration_missing'].includes(billing.reason))return {status:'conversation_saved',billing};
 }
 const c=await elevenRequest<VoiceConversation>(`/v1/convai/conversations/${encodeURIComponent(call.conversation_id)}`,undefined,fetch,signal);
 const result=liveConversationResult(c,{conversationId:call.conversation_id,agentId:call.agent_id,party:call.party});
 if(!result)return {status:'awaiting_conversation'};
 if(Number.isSafeInteger(result.durationSeconds)&&result.durationSeconds!>=0)await db('rpc/icash_record_cost_observation','POST',{p_provider:'elevenlabs_duration',p_event:call.conversation_id,p_source:call.operation_key,p_amount:result.durationSeconds,p_units:'seconds'});
 // This is an observation, NOT a final all-provider cost or a wallet debit.
 if(result.providerCostUsd!==null&&Number.isFinite(result.providerCostUsd)&&result.providerCostUsd>=0){
  await db('rpc/icash_record_cost_observation','POST',{p_provider:'elevenlabs',p_event:call.conversation_id,p_source:call.operation_key,p_amount:result.providerCostUsd,p_units:'USD'});
 }
 // Late usage evidence does not rewrite completed transcripts or callback decisions.
 if(call.state!=='complete')await db('rpc/icash_save_live_result','POST',{p_call:callId,p_result:result});
 return {status:'conversation_saved',billing:await settle()};
}
