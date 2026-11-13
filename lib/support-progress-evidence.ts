import type {SupportOutreachSnapshot} from './support-outreach.ts';

/** A saved no-progress flag describes a check, not the absence of all history.
 * Counts have no activity timestamp and cannot establish recovery or its cause. */
export function supportProgressDelay(outreach:SupportOutreachSnapshot,includeOutreach=true){
 const positive=[outreach.screened,outreach.callsStarted,outreach.textsSent].some(value=>Number.isSafeInteger(value)&&value>0);
 if(!positive)return 'The latest activity check still flags no completed work and marks progress as blocked. That flag does not establish the cause or a restart time.';
 const research=Number.isSafeInteger(outreach.screened)&&outreach.screened>0?`${outreach.screened} properties checked are recorded overall. `:'';
 const activity=includeOutreach?`${outreach.callsStarted} call attempts and ${outreach.textsSent} texts are recorded overall. `:'';
 return research+activity+'The saved progress check flags recent work as blocked. These totals do not establish current progress; I haven’t verified the specific cause or a restart time.';
}
