import {recordingAuthorized} from './direct-call-entry.ts';
import {object} from './required-call-recording.ts';
import {RecordingProviderError} from './required-call-recording-provider.ts';
import {finalRecordingPayload} from './required-call-recording-service.ts';
import {incomingCallIdentityMatches,receptionRecordingMatches,receptionConversationMatches,type RecordedReceptionRow,type RecordedReceptionRpc,type RecordedReceptionEnv} from './recorded-reception.ts';
import {getRecordedReception,transitionRecordedReception,endRecordedReception,boundEndReceipt,bindRecordedReceptionCallStart} from './recorded-reception-service.ts';
import {settleRecordedReception} from './recorded-reception-settlement.ts';
import type {RecordedReceptionProviders} from './recorded-reception-provider.ts';

/** Independent cleanup and termination worker. Launch/account/wallet gates never
 * control recovery or deletion. Provider deletion is verified before finalizing. */
export async function maintainRecordedReception(rpc:RecordedReceptionRpc,provider:RecordedReceptionProviders,env:RecordedReceptionEnv,now=Date.now()){
 const result={deleted:0,reconciled:0,settled:0,held:0};
 async function finish(row:RecordedReceptionRow,kind:string,outcome:string,payload:Record<string,unknown>={}){
  const current=await getRecordedReception(rpc,row.id,row.account_id);if(!current)throw Error('SESSION_MISSING');
  const saved=await rpc('icash_finish_recorded_reception_work',{p_id:row.id,p_account:row.account_id,p_operation:row.operation_key,p_kind:kind,p_lease_token:row[kind==='delete'?'deletion_lease_token':'reconcile_lease_token'],p_expected_version:current.row_version,p_outcome:outcome,p_payload:payload});
  if(!saved)throw Error('WORK_FINISH_NOT_SAVED');return saved;
 }
 // Deletion first and independent of carrier/conversation availability/costs.
 for(const row of await rpc<RecordedReceptionRow[]>('icash_claim_recorded_reception_work',{p_kind:'delete',p_limit:5,p_lease_seconds:120})){
  try{
   if(row.provider_account_sid!==env.TWILIO_ACCOUNT_SID||!row.recording_sid)throw Error('RECORDING_BINDING_REQUIRED');
   let before:Record<string,unknown>|null=null;
   try{before=await provider.getRecording(row.recording_sid,true);}catch(e){if(!(e instanceof RecordingProviderError)||e.status!==404)throw e;}
   if(before&&!receptionRecordingMatches(row,before))throw Error('RECORDING_BINDING_REQUIRED');
   if(before&&before.status!=='deleted')await provider.deleteRecording(row.recording_sid);
   let gone=false;try{const after=await provider.getRecording(row.recording_sid,true);gone=receptionRecordingMatches(row,after)&&after.status==='deleted';}catch(e){if(e instanceof RecordingProviderError&&e.status===404)gone=true;else throw e;}
   if(!gone)throw Error('DELETION_UNCONFIRMED');await finish(row,'delete','deleted');result.deleted++;
  }catch{await finish(row,'delete','retry',{reason:'deletion_confirmation_required'}).catch(()=>null);result.held++;}
 }
 for(const initial of await rpc<RecordedReceptionRow[]>('icash_claim_recorded_reception_work',{p_kind:'reconcile',p_limit:3,p_lease_seconds:120})){
  let row=initial,stage='provider_binding';
  try{
   if(row.provider_account_sid!==env.TWILIO_ACCOUNT_SID)throw Error('PROVIDER_BINDING_REQUIRED');
   // A once-claimed start may have created audio even if its response was lost.
   // Bind its exact Call/account identity and expiry before carrier/end/cost
   // dependencies, so their outage cannot prevent the deletion queue.
   let receipt:Record<string,unknown>|null=null,recordingDiscoveryFailed=false;stage='recording_discovery';
   if(!row.recording_sid&&row.start_claimed_at)try{
    const listed=await provider.listRecordings(row.call_sid);if(listed.next_page_uri!==null||!Array.isArray(listed.recordings)||listed.recordings.length!==1)throw Error('UNIQUE_RECORDING_REQUIRED');
    receipt=object(listed.recordings[0]);if(!receptionRecordingMatches(row,receipt))throw Error('RECORDING_BINDING_REQUIRED');
    const next=await transitionRecordedReception(rpc,row,'started',{recordingSid:receipt.sid,providerStartedAt:new Date(String(receipt.start_time)).toISOString()});if(!next)throw Error('RECORDING_BINDING_SAVE_REQUIRED');row=next;
   }catch{recordingDiscoveryFailed=true;}
   let call:Record<string,unknown>;stage='carrier_readback';
   try{call=await provider.getCall(row.call_sid);}catch{
    // An unavailable read cannot cancel already-durable termination authority.
    // The helper may POST ended to this exact reserved SID, but still refuses
    // to mark terminal until a full account/number/direction readback succeeds.
    if(!row.call_ended_at&&(row.end_requested_at||now>=Date.parse(row.call_deadline_at)||!recordingAuthorized(row)&&now>=Date.parse(row.consent_deadline_at))){const ended=await endRecordedReception(rpc,provider,row,'carrier_read_outage_end');row=ended.row;}
    throw Error('CALL_READ_REQUIRED');
   }
   if(!incomingCallIdentityMatches(row,call))throw Error('CALL_BINDING_REQUIRED');
   let clockConflict=false;try{row=await bindRecordedReceptionCallStart(rpc,row,call);}catch{clockConflict=true;}
   const terminal=['completed','failed','busy','no-answer','canceled'].includes(String(call.status));
   if(terminal){
    if(!row.end_requested_at){const next=await transitionRecordedReception(rpc,row,'request_end',{reason:'carrier_terminal'});if(next)row=next;}
    if(!row.call_ended_at){const next=await transitionRecordedReception(rpc,row,'call_ended',boundEndReceipt(row,call));if(!next)throw Error('TERMINAL_SAVE_REQUIRED');row=next;}
   }else if(await rpc<boolean>('icash_call_credit_available',{p_account:row.account_id,p_operation:row.operation_key})===false){
    const ended=await endRecordedReception(rpc,provider,row,'credits_exhausted');row=ended.row;if(!ended.ended)throw Error('TERMINATION_UNCONFIRMED');
   }else if(clockConflict||row.end_requested_at||now>=Date.parse(row.call_deadline_at)||!recordingAuthorized(row)&&now>=Date.parse(row.consent_deadline_at)){
    const ended=await endRecordedReception(rpc,provider,row,'deadline_or_requested_end');row=ended.row;if(!ended.ended)throw Error('TERMINATION_UNCONFIRMED');
   }
   if(recordingDiscoveryFailed)throw Error('RECORDING_DISCOVERY_REQUIRED');stage='recording_readback';
   if(!receipt&&row.recording_sid&&row.state!=='deleted')receipt=await provider.getRecording(row.recording_sid);
   if(receipt){stage='recording_receipt';
    if(!receptionRecordingMatches(row,receipt))throw Error('RECORDING_BINDING_REQUIRED');
    if(['completed','absent'].includes(String(receipt.status))&&!row.call_ended_at){const ended=await endRecordedReception(rpc,provider,row,'audio_terminal');row=ended.row;if(!ended.ended)throw Error('TERMINATION_UNCONFIRMED');}
    if(receipt.status==='completed'&&(!['available','expired','deletion_pending','deleted'].includes(row.state)||row.state==='available'&&row.provider_recording_price_micros===null&&finalRecordingPayload(receipt).providerRecordingPriceMicros!==undefined)){
     const payload=finalRecordingPayload(receipt),next=await transitionRecordedReception(rpc,row,'available',payload);
     if(!next){
      const current=await getRecordedReception(rpc,row.id,row.account_id);
      const start=Date.parse(payload.providerStartedAt),end=Date.parse(payload.endedAt);
      // Numeric timing differences and fixed flags diagnose provider metadata
      // conflicts without exposing audio, transcripts, phones or credentials.
      console.warn('recorded_reception_receipt_conflict',{sessionId:row.id,
       versionChanged:current?.row_version!==row.row_version,
       startDeltaMs:start-Date.parse(row.provider_started_at??''),
       authorityDeltaMs:start-Date.parse(String(row.consent_at??row.recording_authorized_at??'')),
       endDeadlineDeltaMs:end-Date.parse(row.call_deadline_at),
       durationSeconds:payload.durationSeconds,
       priorEnd:row.ended_at!==null,priorPrice:row.provider_recording_price_micros!==null,
      });
      throw Error('RECORDING_RECEIPT_SAVE_REQUIRED');
     }row=next;
    }else if(receipt.status==='absent'&&row.state!=='absent'){
     const next=await transitionRecordedReception(rpc,row,'absent');if(!next)throw Error('ABSENT_RECEIPT_SAVE_REQUIRED');row=next;
    }
   }
   let conversation:Record<string,unknown>|null=null;stage='conversation_readback';
   // No agent query for declined/unstarted calls. A lost register response is
   // discovered by immutable user-id; it is NEVER registered a second time.
   if(row.register_claimed_at){
    if(row.conversation_id)conversation=await provider.conversation(row.conversation_id);
    else{
     const listed=await provider.conversations(row);if(listed.has_more!==false||!Array.isArray(listed.conversations)||listed.conversations.length!==1)throw Error('UNIQUE_CONVERSATION_REQUIRED');
     const candidate=object(listed.conversations[0]);if(typeof candidate.conversation_id!=='string')throw Error('CONVERSATION_ID_REQUIRED');conversation=await provider.conversation(candidate.conversation_id);
    }
    if(!receptionConversationMatches(row,conversation)){
     const init=object(conversation.conversation_initiation_client_data),vars=object(init.dynamic_variables),phone=object(object(conversation.metadata).phone_call),user='icash-recorded-reception:'+row.id;
     console.warn('recorded_reception_conversation_conflict',{sessionId:row.id,
      agent:conversation.agent_id===row.agent_id,branch:conversation.branch_id===row.branch_id,version:conversation.version_id===row.version_id,
      user:conversation.user_id===user,initUser:init.user_id===user,initBranch:init.branch_id===row.branch_id,recording:vars.icash_reception_recording_id===row.id,
      call:phone.call_sid===row.call_sid,direction:phone.direction==='inbound',from:phone.external_number===row.from_phone,to:phone.agent_number===row.to_phone,
     });
     throw Error('CONVERSATION_BINDING_REQUIRED');
    }
    if(!row.conversation_id){const next=await transitionRecordedReception(rpc,row,'bind_conversation',{conversationId:conversation.conversation_id,agentId:conversation.agent_id,branchId:conversation.branch_id,versionId:conversation.version_id});if(!next)throw Error('CONVERSATION_SAVE_REQUIRED');row=next;}
   }
   // Disputed clocks hold costs, never exact-call recording discovery, expiry
   // scheduling, terminal marking or identity recovery needed for deletion.
   stage='clock_binding';if(clockConflict)throw Error('CALL_START_CONFLICT');
   if(row.call_ended_at){
    // Context is saved only from this exact completed provider conversation.
    // Tool payloads and model summaries never become future call instructions.
    if(conversation?.status==='done'&&Array.isArray(conversation.transcript)){
     const turns=conversation.transcript.map(object).filter(t=>['agent','user'].includes(String(t.role))&&typeof t.message==='string'&&t.message.length<=12000).map(t=>({role:t.role,message:t.message}));
     const transcript=turns.length>80?[...turns.slice(0,40),...turns.slice(-40)]:turns;
     if(transcript.length){
      await rpc('icash_save_seller_inbound_history',{p_session:row.id,p_conversation:row.conversation_id,p_transcript:transcript});
      await rpc('icash_save_buyer_inbound_history',{p_session:row.id,p_conversation:row.conversation_id,p_transcript:transcript});
     }
    }
    stage='settlement';
    const freshCall=terminal?call:await provider.getCall(row.call_sid);
    const settled=await settleRecordedReception(rpc,row,freshCall,conversation,receipt);
    if(settled.settled===true)result.settled++;
    else console.warn('recorded_reception_settlement_pending',{sessionId:row.id,reason:settled.reason,
     carrierPricePending:freshCall.price===null,aiComplete:conversation?.status==='done',aiPricePresent:typeof object(conversation?.metadata).cost_fiat==='number',
    });
    if('reviewRequired' in settled&&settled.reviewRequired)result.held++;
   }
   await finish(initial,'reconcile','checked');result.reconciled++;
  }catch(error){
   // Fixed stage/code fields only: no provider body, numbers, headers or secrets.
   const code=error instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(error.message)?error.message:'RECONCILIATION_REQUIRED';
   console.warn('recorded_reception_reconciliation_held',{sessionId:row.id,stage,code,...(error instanceof RecordingProviderError?{httpStatus:error.status}:{})});
   await finish(initial,'reconcile','retry',{reason:'provider_reconciliation_required'}).catch(()=>null);result.held++;
  }
 }
 return result;
}
