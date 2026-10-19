import {recordingAudioPresentation} from './required-call-recording-receipt.ts';
import {uuid,type RecordingRow} from './required-call-recording.ts';
import type {RecordingDb} from './required-call-recording-service.ts';

const pageSize=20;
type CallRow=RecordingRow&{screening_id:string;party:string};
type Conversation={id:string;account_id:string;screening_id:string;operation_key:string;conversation_id:string};
type TerminalReceipt={recording_id:string;account_id:string;call_sid:string;outcome:string};

/** Recording history is independent of AI completion and transcript ingestion. */
export async function propertyCallHistory(db:RecordingDb,accountId:string,screeningId:string,page=0,now=Date.now()){
 if(!uuid(accountId)||!uuid(screeningId)||!Number.isSafeInteger(page)||page<0||page>10000)throw Error('INVALID_HISTORY_REQUEST');
 const screens=await db<{id:string}[]>(`icash_screening_jobs?account_id=eq.${accountId}&id=eq.${screeningId}&select=id&limit=1`);
 if(screens.length!==1||screens[0].id!==screeningId)return null;
 const filters=new URLSearchParams({account_id:`eq.${accountId}`,screening_id:`eq.${screeningId}`,select:'id,account_id,screening_id,operation_key,conversation_id,party,created_at,state,duration_seconds,audio_expires_at,recording_sid,call_sid,consent_at,recording_authorized_at,entry_policy,deleted_at',order:'created_at.desc,id.desc',limit:String(pageSize+1),offset:String(page*pageSize)});
 const rows=await db<CallRow[]>(`icash_call_recordings?${filters}`);
 if(!Array.isArray(rows)||rows.length>pageSize+1||rows.some(r=>r.account_id!==accountId||r.screening_id!==screeningId||!uuid(r.id)||!r.operation_key.startsWith('voice:')||!uuid(r.operation_key.slice(6))))throw Error('OWNED_RECORDINGS_REQUIRED');
 const visible=rows.slice(0,pageSize);
 const calls=visible.length?await db<Conversation[]>(`icash_live_conversations?${new URLSearchParams({account_id:`eq.${accountId}`,screening_id:`eq.${screeningId}`,operation_key:`in.(${visible.map(r=>r.operation_key).join(',')})`,state:'eq.complete',select:'id,account_id,screening_id,operation_key,conversation_id',limit:String(pageSize)})}`):[];
 if(!Array.isArray(calls)||calls.length>pageSize||calls.some(c=>c.account_id!==accountId||c.screening_id!==screeningId||!uuid(c.id)||!visible.some(r=>r.operation_key===c.operation_key&&r.conversation_id===c.conversation_id)))throw Error('OWNED_CONVERSATIONS_REQUIRED');
 // A missing recording alone cannot tell us whether the seller answered.
 // Use only the saved, account/call-bound carrier receipt; never retry a call here.
 const ended=visible.filter(row=>['failed','absent'].includes(row.state)&&row.call_sid&&!row.recording_sid&&!row.conversation_id);
 const terminal=ended.length?await db<TerminalReceipt[]>(`icash_recorded_gate_terminal_receipts?${new URLSearchParams({account_id:`eq.${accountId}`,recording_id:`in.(${ended.map(row=>row.id).join(',')})`,select:'recording_id,account_id,call_sid,outcome:receipt->>status',limit:String(pageSize)})}`):[];
 if(!Array.isArray(terminal)||terminal.length>ended.length||new Set(terminal.map(row=>row.recording_id)).size!==terminal.length||terminal.some(t=>t.account_id!==accountId||!ended.some(r=>r.id===t.recording_id&&r.call_sid===t.call_sid)))throw Error('OWNED_CALL_OUTCOME_REQUIRED');
 return {recordings:visible.map(row=>{
  const outcome=terminal.find(t=>t.recording_id===row.id)?.outcome;
  return {...recordingAudioPresentation(row,now),...(['no-answer','busy'].includes(outcome??'')?{callOutcome:outcome as 'no-answer'|'busy'}:{}),source:'outbound' as const,party:row.party==='seller'||row.party==='buyer'?row.party:'contact',conversationId:calls.find(c=>c.operation_key===row.operation_key&&c.conversation_id===row.conversation_id)?.id??null};
 }),next:rows.length>pageSize?page+1:null};
}
