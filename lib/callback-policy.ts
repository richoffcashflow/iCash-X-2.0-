/** Eligibility only. A durable queue must persist the job and recheck this policy immediately before dispatch. */
export type CallbackJob = { id:string; opportunityId:string; dueAt:number; sellerTimeZone:string; timeConfirmed:boolean; completed:boolean; canceled:boolean };
export function callbackDecision(job:CallbackJob, context:{now:number;permitted:boolean;contactWindowOpen:boolean;humanTakeover:boolean;botPaused:boolean;creditsReserved:boolean;exclusiveLease:boolean;maxLatenessMs:number}) {
  let zoneValid=true; try {new Intl.DateTimeFormat('en-US',{timeZone:job.sellerTimeZone});} catch {zoneValid=false;}
  if (!job.id || !job.opportunityId || !Number.isFinite(job.dueAt) || !Number.isFinite(context.now) || !Number.isFinite(context.maxLatenessMs) || context.maxLatenessMs<0 || !job.sellerTimeZone || !zoneValid) return 'needs_confirmation';
  if(job.completed || job.canceled) return 'do_not_dispatch';
  if(!context.permitted) return 'blocked_by_permission';
  if(!job.timeConfirmed) return 'needs_confirmation';
  if(context.now<job.dueAt) return 'scheduled';
  if(context.now-job.dueAt>context.maxLatenessMs) return 'missed_callback_review';
  if(context.botPaused || context.humanTakeover) return 'paused';
  if(!context.contactWindowOpen) return 'outside_contact_hours';
  if(!context.creditsReserved) return 'needs_credits';
  if(!context.exclusiveLease) return 'already_claimed';
  return 'ready';
}
