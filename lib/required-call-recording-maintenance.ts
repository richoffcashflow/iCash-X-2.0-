import {settleRecordingGateOnly} from './required-call-recording-billing.ts';
import {object,sha,sid,type RecordingRow} from './required-call-recording.ts';
import {RecordingProviderError,type RecordingEnv,type RecordingProviders} from './required-call-recording-provider.ts';
import {recordingReceipt,finalRecordingPayload,recordingTransition,recordingStopToken,type RecordingDb} from './required-call-recording-service.ts';
/** Cleanup is intentionally independent of launch flags, customer balance, and bot pause. */
export async function maintainRecordings(db:RecordingDb,provider:RecordingProviders,env:RecordingEnv){
 const result={deleted:0,reconciled:0,held:0};
 const finish=(row:RecordingRow,kind:string,outcome:string,payload:Record<string,unknown>)=>db<RecordingRow|null>('rpc/icash_finish_call_recording_work','POST',{p_id:row.id,p_account:row.account_id,p_operation:row.operation_key,p_kind:kind,p_lease_token:row[kind==='delete'?'deletion_lease_token':'reconcile_lease_token'],p_outcome:outcome,p_payload:payload});
 // Bound per invocation. Database leases make overlapping invocations safe.
 for(const row of await db<RecordingRow[]>('rpc/icash_claim_call_recording_work','POST',{p_kind:'delete',p_limit:5,p_lease_seconds:120})){
  try{
   if(row.provider_account_sid!==env.TWILIO_ACCOUNT_SID||!sid(row.recording_sid,'RE'))throw Error('BINDING_REQUIRED');
   let before:Record<string,unknown>|null=null;
   try{before=await provider.getRecording(row.recording_sid,true);}catch(e){if(!(e instanceof RecordingProviderError)||e.status!==404)throw e;}
   if(before&&!recordingReceipt(row,before))throw Error('BINDING_REQUIRED');
   if(before?.status!=='deleted'&&before!==null)await provider.deleteRecording(row.recording_sid);
   let gone=false;
   try{const after=await provider.getRecording(row.recording_sid,true);gone=recordingReceipt(row,after)&&after.status==='deleted';}
   catch(e){if(e instanceof RecordingProviderError&&e.status===404)gone=true;else throw e;}
   if(!gone)throw Error('DELETE_UNCONFIRMED');
   if(await finish(row,'delete','deleted',{}))result.deleted++;else result.held++;
  }catch{await finish(row,'delete','retry',{reason:'provider_deletion_unconfirmed'});result.held++;}
 }
 for(let row of await db<RecordingRow[]>('rpc/icash_claim_call_recording_work','POST',{p_kind:'reconcile',p_limit:3,p_lease_seconds:120})){
  try{
   if(row.provider_account_sid!==env.TWILIO_ACCOUNT_SID||!sid(row.call_sid,'CA'))throw Error('CALL_BINDING_REVIEW_REQUIRED');
   if(row.end_requested_at&&!row.call_ended_at){
    let call=await provider.getCall(row.call_sid!);
    if(!['completed','failed','busy','no-answer','canceled'].includes(String(call.status)))call=await provider.end(row.call_sid!);
    if(call.sid!==row.call_sid||call.account_sid!==row.provider_account_sid||!['completed','failed','busy','no-answer','canceled'].includes(String(call.status)))throw Error('CALL_TERMINATION_UNCONFIRMED');
    const ended=await recordingTransition(db,row,'call_ended',{callSid:row.call_sid,providerAccountSid:row.provider_account_sid,status:call.status});if(!ended)throw Error('CALL_TERMINATION_SAVE_REQUIRED');row=ended;
   }
   // Recover provider conversation identity only from exact provider user/branch/version and Call SID evidence.
   if(row.start_claimed_at&&row.recording_sid&&!row.conversation_id&&['recording','processing','available','expired','absent','failed'].includes(row.state)){
    const list=await provider.conversations(row),rows=list.conversations;
    if(list.has_more!==false||!Array.isArray(rows)||rows.length>1)throw Error('CONVERSATION_BINDING_REVIEW_REQUIRED');
    if(rows.length===0)throw Error('CONVERSATION_BINDING_NOT_YET_AVAILABLE');
    if(rows.length===1){const candidate=object(rows[0]);const c=await provider.conversation(String(candidate.conversation_id));
     const phone=object(object(c.metadata).phone_call),init=object(c.conversation_initiation_client_data);
     if(c.conversation_id!==candidate.conversation_id||c.agent_id!==row.agent_id||c.branch_id!==row.branch_id||c.version_id!==row.version_id||c.user_id!=='icash-recorded:'+row.id||phone.call_sid!==row.call_sid||phone.direction!=='outbound'||phone.external_number!==row.to_phone||phone.agent_number!==row.from_phone||init.user_id!==c.user_id)throw Error('CONVERSATION_BINDING_REVIEW_REQUIRED');
     await recordingTransition(db,row,'bind_conversation',{conversationId:c.conversation_id,toolTokenHash:sha(recordingStopToken(row.operation_key,env))});
    }
   }
   if(!row.start_claimed_at){
    let terminal=row;const call=await provider.getCall(row.call_sid!);
    if(row.state==='consent_pending'&&['completed','busy','failed','no-answer','canceled'].includes(String(call.status))){const failed=await recordingTransition(db,row,'fail',{reason:'call_ended_before_recording'});if(failed)terminal=failed;}
    const settled=object(await settleRecordingGateOnly(db,provider,terminal));if(settled.settled===true)result.reconciled++;else{await finish(terminal,'reconcile','retry',{reason:'terminal_carrier_reconciliation_required'});result.held++;}continue;
   }
   let receipt:Record<string,unknown>;
   if(row.recording_sid)receipt=await provider.getRecording(row.recording_sid);
   else{
    const list=await provider.listRecordings(row.call_sid!),all=list.recordings;
    if(list.next_page_uri!==null&&list.next_page_uri!==undefined||!Array.isArray(all)||all.length!==1)throw Error('RECORDING_START_REVIEW_REQUIRED');
    receipt=object(all[0]);
   }
   if(!recordingReceipt(row,receipt))throw Error('BINDING_REQUIRED');
   let outcome:string,payload:Record<string,unknown>;
   if(receipt.status==='completed'){
    if(!row.end_requested_at){const requested=await recordingTransition(db,row,'stop',{stopTokenHash:row.stop_token_hash});if(!requested)throw Error('CALL_TERMINATION_REQUEST_REQUIRED');row=requested;}
    if(!row.call_ended_at){const ended=await provider.end(row.call_sid!);if(ended.sid!==row.call_sid||ended.account_sid!==row.provider_account_sid||ended.status!=='completed')throw Error('CALL_TERMINATION_UNCONFIRMED');const saved=await recordingTransition(db,row,'call_ended',{callSid:row.call_sid,providerAccountSid:row.provider_account_sid,status:ended.status});if(!saved)throw Error('CALL_TERMINATION_SAVE_REQUIRED');row=saved;}
    outcome='available';payload=finalRecordingPayload(receipt);
   }
   else if(receipt.status==='absent'){const ended=await provider.end(row.call_sid!);if(ended.sid!==row.call_sid||ended.account_sid!==row.provider_account_sid||ended.status!=='completed')throw Error('REQUIRED_RECORDING_END_UNCONFIRMED');outcome='absent';payload={};}
   else{outcome='processing';payload={recordingSid:receipt.sid,providerStartedAt:new Date(String(receipt.start_time)).toISOString()};}
   if(await finish(row,'reconcile',outcome,payload))result.reconciled++;else result.held++;
  }catch{await finish(row,'reconcile','retry',{reason:'provider_recording_reconciliation_required'});result.held++;}
 }
 return result;
}
