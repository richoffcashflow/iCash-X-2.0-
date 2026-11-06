import {prepareCompletedSellerDraft} from './automatic-contract-preparation.ts';
import {db as database} from '@/lib/stripe-test';
import {elevenRequest} from '@/lib/elevenlabs';
import {readVoiceUsagePolicies,settleBoundVoiceUsage} from './voice-usage-service.ts';
import {liveConversationResult} from './deal-conversation.ts';
import type {VoiceConversation} from './voice-result.ts';
export async function reconcileLiveConversation(accountId:string,callId:string,signal?:AbortSignal){
 const db:typeof database=(path,method,body)=>{signal?.throwIfAborted();return database(path,method,body,signal);};
 const [call]=await db<{conversation_id:string;agent_id:string;party:'seller'|'buyer';state:string;operation_key:string}[]>(`icash_live_conversations?id=eq.${callId}&account_id=eq.${accountId}&select=conversation_id,agent_id,party,state,operation_key`);
 if(!call)return {status:'not_found'};
 const prepare=async()=>{try{return await prepareCompletedSellerDraft(db,accountId,callId);}catch{return {status:'draft_review_needed'};}};
 const settle=()=>settleBoundVoiceUsage(db,accountId,callId,readVoiceUsagePolicies(process.env.VOICE_USAGE_POLICIES_JSON,process.env.VOICE_USAGE_POLICY_ACTIVATIONS_JSON),{env:{TWILIO_ACCOUNT_SID:process.env.TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN:process.env.TWILIO_AUTH_TOKEN,ELEVENLABS_API_KEY:process.env.ELEVENLABS_API_KEY},signal});
 const recordUsage=async(duration:number|null|undefined,cost:number|null|undefined)=>{
  if(Number.isSafeInteger(duration)&&duration!>=0)await db('rpc/icash_record_cost_observation','POST',{p_provider:'elevenlabs_duration',p_event:call.conversation_id,p_source:call.operation_key,p_amount:duration,p_units:'seconds'});
  // A bound provider USD observation is not a final all-provider cost or debit.
  if(typeof cost==='number'&&Number.isFinite(cost)&&cost>=0)await db('rpc/icash_record_cost_observation','POST',{p_provider:'elevenlabs',p_event:call.conversation_id,p_source:call.operation_key,p_amount:cost,p_units:'USD'});
 };
 let policyHold:Awaited<ReturnType<typeof settle>>|undefined;
 if(call.state==='complete'){
  await prepare();
  const billing=await settle();
  if(billing.status!=='held'||!['provider_receipt_missing','duration_missing'].includes(billing.reason)){
   if(billing.status!=='held'||!['reviewed_policy_missing','reviewed_policy_invalid'].includes(billing.reason))return {status:'conversation_saved',billing};
   // Preserve historical policy holds, but do not let them prevent collection
   // of a genuine late original USD receipt. Existing evidence needs no GET.
   const observations=await db<{amount:unknown;units:string}[]>(`icash_cost_observations?provider=eq.elevenlabs&event_key=eq.${encodeURIComponent(call.conversation_id)}&source_ref=eq.${encodeURIComponent(call.operation_key)}&select=amount,units`);
   if(observations.length)return {status:'conversation_saved',billing};
   policyHold=billing;
  }
 }
 const c=await elevenRequest<VoiceConversation>(`/v1/convai/conversations/${encodeURIComponent(call.conversation_id)}`,undefined,fetch,signal);
 if(policyHold||(call.state==='complete'&&c.status==='done')){
  if(c.conversation_id!==call.conversation_id||c.agent_id!==call.agent_id)throw Error('VOICE_ID_MISMATCH');
  // Completed metadata can outlive optional analysis/transcript retention.
  // Failed conversations still require the existing exact quota-failure proof.
  const usage=c.status==='done'?{durationSeconds:c.metadata?.call_duration_secs,providerCostUsd:c.metadata?.cost_fiat}:liveConversationResult(c,{conversationId:call.conversation_id,agentId:call.agent_id,party:call.party});
  if(usage)await recordUsage(usage.durationSeconds,usage.providerCostUsd);
  return {status:'conversation_saved',billing:policyHold??await settle()};
 }
 const result=liveConversationResult(c,{conversationId:call.conversation_id,agentId:call.agent_id,party:call.party});
 if(!result)return {status:'awaiting_conversation'};
 await recordUsage(result.durationSeconds,result.providerCostUsd);
 // Late usage evidence does not rewrite completed transcripts or callback decisions.
 if(call.state!=='complete'){await db('rpc/icash_save_live_result','POST',{p_call:callId,p_result:result});await prepare();}
 return {status:'conversation_saved',billing:await settle()};
}
