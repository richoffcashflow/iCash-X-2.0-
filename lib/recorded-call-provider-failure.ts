import {object,type RecordingRow} from './required-call-recording.ts';
import {canonicalCall} from './required-call-recording-service.ts';
import {emptyQuotaRejection} from './voice-result.ts';
import type {RecordingProviders} from './required-call-recording-provider.ts';

/** Only a proven, never-started quota rejection can use the provider's phone user ID.
 * It admits no new provider work and is not proof of a final billing amount. */
export function recordedQuotaFailure(row:RecordingRow,c:Record<string,unknown>){
 const m=object(c.metadata),p=object(m.phone_call),init=object(c.conversation_initiation_client_data);
 const start=Number(m.start_time_unix_secs)*1000,created=Date.parse(row.created_at);
 if(!/^conv_[A-Za-z0-9]{1,160}$/.test(String(c.conversation_id))||!emptyQuotaRejection(c)
  ||c.agent_id!==row.agent_id||c.branch_id!==row.branch_id||c.version_id!==row.version_id
  ||c.user_id!==row.to_phone||init.user_id!=null&&init.user_id!==row.to_phone
  ||init.branch_id!=null&&init.branch_id!==row.branch_id
  ||p.call_sid!==row.call_sid||p.direction!=='outbound'||p.external_number!==row.to_phone||p.agent_number!==row.from_phone
  ||typeof m.start_time_unix_secs!=='number'||!Number.isSafeInteger(m.start_time_unix_secs)||!Number.isFinite(created)||start<created-5000||start>created+1200000)return null;
 return {conversationId:c.conversation_id,agentId:c.agent_id,branchId:c.branch_id,versionId:c.version_id,
  userId:c.user_id,callSid:p.call_sid,direction:p.direction,fromPhone:p.agent_number,toPhone:p.external_number,
  status:'failed',reason:'quota_exceeded',durationSeconds:0,messageCount:0,startAt:new Date(start).toISOString()};
}

export async function findRecordedQuotaFailure(provider:RecordingProviders,row:RecordingRow){
 if(row.conversation_id||!row.call_ended_at||!row.recording_sid||!row.start_claimed_at||!['available','expired','absent','failed'].includes(row.state))return null;
 const list=await provider.failedConversations(row),candidates=list.conversations;
 if(list.has_more!==false||!Array.isArray(candidates)||candidates.length!==1)return null;
 const id=object(candidates[0]).conversation_id;
 if(typeof id!=='string'||!/^conv_[A-Za-z0-9]{1,160}$/.test(id))return null;
 const conversation=await provider.conversation(id);
 if(conversation.conversation_id!==id)return null;
 const failure=recordedQuotaFailure(row,conversation);if(!failure)return null;
 const carrier=await provider.getCall(row.call_sid!);
 const created=Date.parse(String(carrier.date_created)),expected=Date.parse(row.created_at);
 if(!canonicalCall(row,carrier,Date.now(),false,false)||!['completed','failed','busy','no-answer','canceled'].includes(String(carrier.status))
  ||!Number.isFinite(created)||created<expected-5000||created>expected+120000)return null;
 return conversation;
}
