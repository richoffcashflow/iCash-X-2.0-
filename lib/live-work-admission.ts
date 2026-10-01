/** Funding availability is not permission to start live provider work. */
export function liveWorkReady(env:NodeJS.ProcessEnv=process.env){return env.ICASH_LIVE_WORK_READY==='true';}
/** Independent property release buys property-only pages; contacts have a separate gate. */
export function discoveryWorkEnabled(env:NodeJS.ProcessEnv=process.env){return liveWorkReady(env)||env.ICASH_DISCOVERY_WORK_READY==='true';}
/** Only the bounded, atomically claimed owner contact adapter is independently releasable. */
export function contactWorkEnabled(env:NodeJS.ProcessEnv=process.env){return liveWorkReady(env)||env.ICASH_CONTACT_WORK_READY==='true';}
/** SMS is independently releasable; this never admits voice, contracts or lead purchases. */
export function smsWorkEnabled(env:NodeJS.ProcessEnv=process.env){return liveWorkReady(env)||env.ICASH_SMS_WORK_READY==='true';}
export function automationWorkReady(kind:string,env:NodeJS.ProcessEnv=process.env){return liveWorkReady(env)||(kind==='seller_opener'&&smsWorkEnabled(env))||(kind==='discovery'&&discoveryWorkEnabled(env))||(kind==='contacts'&&contactWorkEnabled(env));}
export const newLiveWorkKinds=new Set(['seller_opener','market_research','text_ai','title_followup','fulfillment','voice_dispatch','discovery','contacts']);
type Ticket={id:string;accountId:string;kind:string;screeningId?:string|null;voiceJobId?:string|null;fulfillmentJobId?:string|null;titleTaskId?:string|null;textAiJobId?:string|null;marketResearchJobId?:string|null;openerMessageId?:string|null};
type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
/** Only unstarted work is deferred. Consumed capability is never rearmed or reused. */
export async function deferUnstartedAutomation(db:Database,t:Ticket,token:string){
 if(!newLiveWorkKinds.has(t.kind))throw Error('Not a new-work ticket');
 const scope=`id=eq.${t.id}&account_id=eq.${t.accountId}&kind=eq.${t.kind}&token=eq.${encodeURIComponent(token)}&state=eq.consumed`;
 const [prior]=await db<{issue_attempts:number}[]>(`icash_automation_tickets?${scope}&select=issue_attempts`);
 if(!prior||!Number.isInteger(prior.issue_attempts)||prior.issue_attempts<1||prior.issue_attempts>3)throw Error('Ticket changed');
 if(t.kind==='contacts'){
  if(!t.screeningId)throw Error('Contact ticket missing its screening');
  const operations=await db<unknown[]>(`icash_operation_spend?operation_key=eq.owners:${t.accountId}:${t.screeningId}&select=operation_key&limit=1`);
  if(operations.length)throw Error('Existing operation requires reconciliation');
 }
 const now=new Date().toISOString(),later=new Date(Date.now()+15*60000).toISOString();
 const changed=await db<{id:string}[]>(`icash_automation_tickets?${scope}&issue_attempts=eq.${prior.issue_attempts}`,'PATCH',{
  state:'held',outcome:t.kind==='contacts'?'expired':'live_work_not_ready',expires_at:now,completed_at:now,
  // Legacy contact retry accepts only expired unused capabilities. Do not burn a
  // provider-attempt allowance while no provider operation has been started.
  ...(t.kind==='contacts'?{issue_attempts:Math.max(1,prior.issue_attempts-1)}:{}),
 });
 if(changed.length!==1)throw Error('Ticket changed');
 // Never alter claimed/dispatching jobs, reservations, or provider receipts.
 if(t.kind==='voice_dispatch'&&t.voiceJobId)await db(`icash_voice_jobs?id=eq.${t.voiceJobId}&account_id=eq.${t.accountId}&state=eq.issued`,'PATCH',{state:'ready',updated_at:now});
 if(t.kind==='fulfillment'&&t.fulfillmentJobId)await db(`icash_fulfillment_jobs?id=eq.${t.fulfillmentJobId}&account_id=eq.${t.accountId}&state=eq.issued`,'PATCH',{state:'ready',updated_at:now});
 if(t.kind==='text_ai'&&t.textAiJobId)await db(`icash_text_ai_jobs?id=eq.${t.textAiJobId}&account_id=eq.${t.accountId}&state=eq.issued`,'PATCH',{state:'pending',next_attempt_at:later,updated_at:now});
 if(t.kind==='market_research'&&t.marketResearchJobId)await db(`icash_market_research_jobs?id=eq.${t.marketResearchJobId}&account_id=eq.${t.accountId}&state=eq.issued`,'PATCH',{state:'pending',next_attempt_at:later,updated_at:now});
 if(t.kind==='title_followup'&&t.titleTaskId)await db(`icash_title_tasks?id=eq.${t.titleTaskId}&account_id=eq.${t.accountId}&email_state=eq.issued`,'PATCH',{email_state:'waiting',email_retry_at:later,updated_at:now});
 if(t.kind==='seller_opener'&&t.openerMessageId)await db(`icash_text_messages?id=eq.${t.openerMessageId}&account_id=eq.${t.accountId}&state=eq.ready`,'PATCH',{state:'needs_review',updated_at:now});
 if(t.kind==='discovery'||t.kind==='contacts')await db(`icash_discovery_configs?account_id=eq.${t.accountId}`,'PATCH',{next_run_at:later});
 return {status:'live_work_not_ready'};
}
