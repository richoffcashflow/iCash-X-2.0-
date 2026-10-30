import type {SupportEvidence} from './support-policy.ts';

type SavedJob={state:string;outcome:string|null;updated_at:string};
const reasons:Record<string,string>={
 production_agent_review_required:'the calling service could not be verified against its approved setup. Adding money or changing your own phone number does not repair that check',
 recorded_call_review_required:'the required calling review was not current',
 business_number_mismatch:'the calling service number did not match the saved business number. Changing your personal number does not repair that mismatch',
 contact_operating_checks_required:'the seller contact checks were missing or no longer current',
 voice_configuration_required:'the calling service setup was incomplete',
 prospecting_budget_held:'its credit check did not pass. This saved result does not establish how much is available now',
};

/** The latest saved job is evidence of a past hold, never proof of current readiness. */
export function supportVoiceEvidence(jobs:SavedJob[],reviewCount:number):Omit<SupportEvidence,'key'|'source'|'observedAt'>{
 if(!Number.isSafeInteger(reviewCount)||reviewCount<0||jobs.length>1||jobs.some(j=>!Number.isFinite(Date.parse(j.updated_at))))throw Error('Invalid voice evidence');
 const job=jobs[0],reason=job?.state==='held'&&job.outcome?reasons[job.outcome]:null;
 if(reason)return {code:'voice_'+job.outcome,status:'attention',detail:`The latest saved call was held because ${reason}. This does not confirm the next call is ready; no call was restarted here.`};
 return {code:reviewCount?'voice_review':'voice_clear',status:reviewCount?'attention':'ok',detail:reviewCount?`${reviewCount}${reviewCount===20?'+':''} call results need review. Chat will not redial or repeat provider actions.`:'No call results marked for review were found. This does not confirm the next call is ready.'};
}
