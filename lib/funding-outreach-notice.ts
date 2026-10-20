import {outreachHoursPolicyVersion,withinOutreachHours} from './outreach-hours.ts';

type FundingBotState={paused?:boolean;ready:boolean;stale:boolean;test:boolean};
const businessClock={timezone:'America/Chicago',startHour:9,endHour:21,activeConversation:false,policyVersion:outreachHoursPolicyVersion} as const;
export const fundingOutreachSchedule='New outreach runs 9 AM–9 PM in the seller’s time zone when known; otherwise Central Time. Research can continue overnight.';

/** Display copy only. Actual contact eligibility and timing remain server-enforced. */
export function fundingOutreachNotice(state:FundingBotState,now:number){
 if(state.test)return {title:'Test credits added',detail:'This was a test payment. It does not start live outreach.'};
 if(state.stale)return {title:'Credits added',detail:'Checking your bot’s status. Your payment is confirmed—there’s no need to pay again.'};
 if(state.paused===true)return {title:'Credits added. Your bot is still paused.',detail:'Select Run bot when you’re ready. New outreach follows the 9 AM–9 PM schedule.'};
 if(!state.ready||state.paused!==false)return {title:'Credits added',detail:'Your bot is checking what’s ready next. Eligible outreach starts automatically once your account is ready.'};
 if(withinOutreachHours(businessClock,now))return {title:'Credits added. Let’s get to work.',detail:'Your bot can start eligible outreach automatically. New properties and seller replies appear here as they arrive.'};
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:businessClock.timezone,hour:'2-digit',hourCycle:'h23'}).format(now));
 return {title:'Credits added. Ready for the morning.',detail:`The next outreach window opens ${hour<9?'today':'tomorrow'} at 9 AM Central, or at 9 AM in the seller’s time zone when known.`};
}
