type Db=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
export type VoiceAutomationClaim={ticketId:string;token:string};
const reasons=new Set(['recording_release_required','recording_review_required','business_number_verification_required',
 'live_work_not_ready','recorded_call_release_required','recorded_call_review_required']);
/** Only the currently consumed automation capability can attest a synchronous
 * return before recording admission. A status alone, an old job, or missing
 * provider rows never authorizes release of an uncertain operation. */
export async function finishVoicePredialAbort(db:Db,input:{accountId:string;jobId:string;automation:VoiceAutomationClaim|undefined;
 dispatchedAt:string|null;result:{status:string;dispatchBoundary?:string}}){
 const beforeCreate=input.result.dispatchBoundary==='before_recording_create_v1'&&reasons.has(input.result.status);
 const rejectedAdmission=input.result.dispatchBoundary==='recording_admission_rejected_v1'&&input.result.status==='recording_admission_held';
 if(!input.automation||!input.dispatchedAt||(!beforeCreate&&!rejectedAdmission))return false;
 try{return await db<boolean>('rpc/icash_finish_voice_predial_abort','POST',{
  p_account:input.accountId,p_job:input.jobId,p_ticket:input.automation.ticketId,p_token:input.automation.token,
  p_dispatched_at:input.dispatchedAt,p_reason:input.result.status,p_boundary:input.result.dispatchBoundary,
 },AbortSignal.timeout(8000))===true;}catch{return false;}
}
