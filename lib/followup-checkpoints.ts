import type {VoiceUsageDb} from './voice-usage-service';

export type FollowupStep='estimates'|'voice_receipts'|'customer_updates'|'attention';
type StepResult={complete:boolean;evidence:Record<string,unknown>};
type Step={name:FollowupStep;timeoutMs:number;run:(db:VoiceUsageDb,signal:AbortSignal)=>Promise<StepResult>};

/** Recovery steps only. A checkpoint never grants permission to repeat a primary
 * call, text or purchase. Each existing service still reconciles/claims its own
 * original IDs. A lost acknowledgment leaves a durable unfinished attempt.
 */
export async function processFollowupCheckpoints(database:VoiceUsageDb,accountId:string,ticketId:string,steps:Step[]){
 let success=true;
 const outcomes:Partial<Record<FollowupStep,Record<string,unknown>>>={};
 for(const step of steps){
  let claim:{status:'claimed'|'completed'|'busy';id?:string;evidence?:Record<string,unknown>}|null;
  try{
   claim=await database('rpc/icash_claim_followup_step','POST',
    {p_account:accountId,p_ticket:ticketId,p_step:step.name},AbortSignal.timeout(5000));
  }catch{success=false;outcomes[step.name]={status:'claim_unavailable'};continue;}
  if(claim?.status==='completed'){outcomes[step.name]=claim.evidence??{status:'checkpoint_complete'};continue;}
  if(claim?.status!=='claimed'||!claim.id){success=false;outcomes[step.name]={status:'lease_unavailable'};continue;}
  const signal=AbortSignal.timeout(step.timeoutMs);
  const db:VoiceUsageDb=(path,method,body)=>{signal.throwIfAborted();return database(path,method,body,signal);};
  let result:StepResult;
  try{result=await step.run(db,signal);}
  catch{result={complete:false,evidence:{status:signal.aborted?'deadline_reached':'recovery_unavailable'}};}
  outcomes[step.name]=result.evidence;
  if(!result.complete)success=false;
  try{
   const saved=await database<boolean>('rpc/icash_finish_followup_step','POST',
    {p_account:accountId,p_ticket:ticketId,p_step:step.name,p_attempt:claim.id,p_complete:result.complete,p_evidence:result.evidence},AbortSignal.timeout(5000));
   if(!saved)success=false;
  }catch{success=false;}
 }
 return {success,outcomes};
}
