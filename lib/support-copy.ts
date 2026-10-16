import type {SupportEvidence} from './support-policy';

export const supportGreeting='Hi! How can we help?';
export const supportCancellationReply='Sure. Open Chat options (•••) and choose Manage cancellation. You’ll review the details before confirming. Sending a message won’t cancel your plan. For a refund or account deletion, tap Ask the team.';
export const supportTeamReply='Of course. Tap Ask the team below to send this conversation over. You’ll see their reply here.';
export const supportUnavailableReply='I couldn’t check your account details just now. Please try again, or tap Ask the team for help.';

/** Plain-language replies use verified checks, never inferred repairs or promised actions. */
export function supportEvidenceReply(e:SupportEvidence){
 if(e.status==='unknown')return 'I couldn’t check that just now. Please refresh and try again. If it still won’t load, tap Ask the team.';
 switch(e.code){
  case 'paused':return 'Your bot is paused right now. You can review the pause in your workspace. If you didn’t pause it, tap Ask the team before restarting it. Work already in progress may still finish.';
  case 'not_paused':return 'Your bot isn’t paused. If something still looks stuck, tell us which property you’re working on and what you expected to happen.';
  case 'no_available_credit':return 'There’s no available work credit right now. Open your workspace to check your balance and any credit reserved for work. Adding credit won’t clear a separate service issue.';
  case 'credit_available':{
   const amounts=/has (\$[\d,.]+) available and (\$[\d,.]+) held/.exec(e.detail);
   return amounts?`You have ${amounts[1]} available for work and ${amounts[2]} reserved for work already in progress. Work credit is separate from your subscription.`:e.detail;
  }
  case 'renewal_stop_unconfirmed':return 'Your cancellation request is saved, but stopping renewals isn’t confirmed yet. Tap Ask the team so this can be checked. Please don’t start another checkout.';
  case 'renewal_payment_failed':return 'Your subscription payment needs a closer look. Tap Ask the team before trying another checkout, especially if your bank shows a pending charge.';
  case 'renewal_active':return e.key==='subscription'?'Your software subscription is active. Work credit is billed separately. What would you like help with?':'An earlier daily renewal plan is still listed as active. You can review it under Chat options (•••), then Manage cancellation.';
  case 'software_renewals_stopped':return 'Future renewals for your software subscription are stopped. You can check your remaining paid access in your workspace.';
  case 'no_software_subscription':return 'I couldn’t find a software subscription linked to this account. If you’ve already joined, check that you’re signed in with the email you used at checkout.';
  case 'checkout_pending':return 'Your checkout is still showing as pending, so I can’t confirm the payment yet. If you just paid, refresh first. Please don’t pay again; tap Ask the team if it doesn’t update.';
  case 'payment_uncredited':return 'I can see a payment on your account, but the credit hasn’t been added yet. Please don’t pay again. Tap Ask the team so that payment can be checked.';
  case 'payment_recorded':return /Test payments do not fund/.test(e.detail)?'Your test payment is recorded. Test payments don’t add credit to your live work balance.':'Your recent work-credit payments are marked as credited. Your available balance can change as work is completed or credit is reserved.';
  case 'no_payment_records':return 'I couldn’t find a completed work-credit purchase in the recent records for this account. If your bank shows a charge, tap Ask the team and include the date and amount. Please leave out your full card number.';
  case 'no_renewals':return 'There’s no ongoing daily renewal plan listed for this account. Your software subscription is separate.';
  case 'readiness_blocked':return 'A service check needs attention before new work can continue. Tap Ask the team so it can be reviewed. Adding credit won’t clear this issue.';
  case 'readiness_ready':return 'The service checks passed. If you’re having trouble, tell us what you tried and what happened.';
  case 'screening_review':return 'A property check needs a closer look. Tap Ask the team and mention the property you’re working on.';
  case 'voice_review':return 'A call result needs review. Tap Ask the team before retrying so you don’t duplicate the call.';
  case 'screening_clear':return 'There are no failed property checks in the records I checked.';
  case 'voice_clear':return 'There are no call results waiting for review in the records I checked.';
  default:return e.detail;
 }
}
