import type {ConversationCall} from './conversation-timeline.ts';
import type {RecordingDb} from './required-call-recording-service.ts';
import {propertyCallHistory} from './property-call-history.ts';

/** Read only: include carrier-backed calls even before an AI transcript finishes. */
export async function threadConversationCalls(db:RecordingDb,accountId:string,thread:{id:string;dealId:string;recipient:string;party:string},before:string|null,after:string|null,recordingsEnabled:boolean){
 const completed=db<ConversationCall[]>('rpc/icash_thread_calls','POST',{p_account:accountId,p_thread:thread.id,p_before:before,p_after:after});
 const recorded=async()=>{
  if(!recordingsEnabled)return [];
  const deals=await db<{id:string;screening_id:string}[]>(`icash_deal_files?${new URLSearchParams({id:`eq.${thread.dealId}`,account_id:`eq.${accountId}`,select:'id,screening_id',limit:'1'})}`);
  if(deals.length!==1||deals[0].id!==thread.dealId)throw Error('OWNED_DEAL_REQUIRED');
  const history=await propertyCallHistory(db,accountId,deals[0].screening_id,0,Date.now(),{phone:thread.recipient,party:thread.party,before,after});
  if(!history)throw Error('OWNED_PROPERTY_REQUIRED');
  return history.recordings;
 };
 const [callsResult,recordingsResult]=await Promise.allSettled([completed,recorded()]);
 const calls=callsResult.status==='fulfilled'?callsResult.value:[];
 const recordings=recordingsResult.status==='fulfilled'?recordingsResult.value:[];
 const merged:ConversationCall[]=calls.map(call=>{
  const recording=recordings.find(r=>r.source===call.source&&r.conversationId===call.id);
  return recording?{...call,recordingId:recording.id,recordingReceipt:recording}:call;
 });
 for(const recording of recordings){
  if(calls.some(c=>c.source===recording.source&&c.id===recording.conversationId))continue;
  merged.push({id:recording.conversationId??recording.id,source:recording.source,party:recording.party,
   completedAt:recording.createdAt,durationSeconds:recording.durationSeconds??undefined,
   recordingId:recording.id,recordingReceipt:recording,transcriptAvailable:!!recording.conversationId});
 }
 return {calls:merged,callsUnavailable:callsResult.status==='rejected'||recordingsResult.status==='rejected'};
}
