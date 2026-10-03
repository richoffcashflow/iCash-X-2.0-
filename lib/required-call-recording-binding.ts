import {object,sha,type RecordingRow} from './required-call-recording.ts';
import {createRecordingProviders,type RecordingEnv,type RecordingProviders} from './required-call-recording-provider.ts';
import {recordingTransition,type RecordingDb} from './required-call-recording-service.ts';
/** Existing per-call capability selects the session. Model-supplied IDs never establish authority.
 * Legacy calls return false; their unchanged DB tool binding still decides authorization. */
export async function ensureRecordedConversationBinding(token:string,conversationId:string,db:RecordingDb,env:RecordingEnv,provider?:RecordingProviders){
 if(env.ICASH_RECORDING_RECEIPTS_READY!=='true')return false;
 if(!/^[a-f0-9]{64}$/.test(token)||!/^conv_[A-Za-z0-9]+$/.test(conversationId))throw Error('RECORDING_BINDING_REQUIRED');
 const rows=await db<RecordingRow[]>(`icash_call_recordings?stop_token_hash=eq.${sha(token)}&select=*&limit=2`);
 if(rows.length===0)return false;if(rows.length!==1)throw Error('RECORDING_BINDING_CONFLICT');const row=rows[0];
 if(row.conversation_id){if(row.conversation_id!==conversationId)throw Error('RECORDING_BINDING_CONFLICT');return true;}
 if(!row.consent_at||!row.recording_sid||!row.call_sid||row.provider_account_sid!==env.TWILIO_ACCOUNT_SID||!['recording','processing','available','expired','deletion_pending','absent','failed'].includes(row.state))throw Error('RECORDING_BINDING_REQUIRED');
 const p=provider??createRecordingProviders(env),c=await p.conversation(conversationId),phone=object(object(c.metadata).phone_call),init=object(c.conversation_initiation_client_data);
 if(c.conversation_id!==conversationId||c.agent_id!==row.agent_id||c.branch_id!==row.branch_id||c.version_id!==row.version_id||c.user_id!=='icash-recorded:'+row.id||init.user_id!==c.user_id||phone.call_sid!==row.call_sid||phone.direction!=='outbound'||phone.external_number!==row.to_phone||phone.agent_number!==row.from_phone)throw Error('CANONICAL_CONVERSATION_BINDING_REQUIRED');
 const bound=await recordingTransition(db,row,'bind_conversation',{conversationId,toolTokenHash:sha(token)});
 if(!bound){const [current]=await db<RecordingRow[]>(`icash_call_recordings?id=eq.${row.id}&account_id=eq.${row.account_id}&select=*`);if(!current||current.conversation_id!==conversationId)throw Error('RECORDING_BINDING_CONFLICT');}
 return true;
}
