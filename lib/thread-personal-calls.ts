import type {ConversationCall} from './conversation-timeline.ts';
import type {RecordingDb} from './required-call-recording-service.ts';
import {sid,uuid} from './required-call-recording.ts';

type PersonalCall={id:string;account_id:string;screening_id:string;recipient_phone:string;created_at:string;ended_at:string|null;state:string;recording_required:boolean;recording_state:string;recording_sid:string|null;recording_expires_at:string|null;recording_deleted_at:string|null;duration:unknown};

/** Saved manual/browser calls only. Playback still verifies the provider receipt. */
export async function threadPersonalCalls(db:RecordingDb,accountId:string,screeningId:string,phone:string,before:string|null,after:string|null,now=Date.now()):Promise<ConversationCall[]>{
 if(!uuid(accountId)||!uuid(screeningId)||!/^\+[1-9]\d{7,14}$/.test(phone)||[before,after].some(at=>at&&!Number.isFinite(Date.parse(at))))throw Error('INVALID_CONTACT_HISTORY');
 const filters=new URLSearchParams({account_id:`eq.${accountId}`,screening_id:`eq.${screeningId}`,recipient_phone:`eq.${phone}`,ended_at:'not.is.null',order:'created_at.desc,id.desc',limit:'20',select:'id,account_id,screening_id,recipient_phone,created_at,ended_at,state,recording_required,recording_state,recording_sid,recording_expires_at,recording_deleted_at,duration:recording_receipt->durationSeconds'});
 if(before)filters.append('created_at',`lt.${before}`);
 if(after)filters.append('created_at',`gte.${after}`);
 const rows=await db<PersonalCall[]>(`icash_customer_phone_calls?${filters}`);
 if(!Array.isArray(rows)||rows.length>20||rows.some(row=>!uuid(row.id)||row.account_id!==accountId||row.screening_id!==screeningId||row.recipient_phone!==phone||!row.ended_at||!Number.isFinite(Date.parse(row.created_at))||(before&&Date.parse(row.created_at)>=Date.parse(before))||(after&&Date.parse(row.created_at)<Date.parse(after))))throw Error('OWNED_CONTACT_CALLS_REQUIRED');
 return rows.map(row=>{
  const duration=typeof row.duration==='number'&&Number.isFinite(row.duration)&&row.duration>=0?row.duration:null;
  const expires=row.recording_expires_at&&Number.isFinite(Date.parse(row.recording_expires_at))?row.recording_expires_at:null;
  const status=!row.recording_required?'not_recorded':row.recording_deleted_at||row.recording_state==='deleted'?'deleted':expires&&Date.parse(expires)<=now?'expired':row.recording_state==='available'&&sid(row.recording_sid,'RE')&&expires?'available':row.recording_state==='absent'?'absent':row.recording_state==='failed'?'failed':'processing';
  return {id:row.id,source:'personal',party:'seller',completedAt:row.created_at,durationSeconds:duration??undefined,transcriptAvailable:false,
   recordingReceipt:{id:row.id,status,durationSeconds:duration,audioExpiresAt:expires,...(['absent','failed'].includes(status)&&['no-answer','busy'].includes(row.state)?{callOutcome:row.state as 'no-answer'|'busy'}:{})}};
 });
}
