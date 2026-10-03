import {discoveryBlockerMessage} from './discovery-blocker-message.ts';
export function workspaceStatus(a:{billingModel?:string;membershipActive?:boolean;billingReview?:boolean;paused?:boolean;workReady?:boolean;smsWorkReady?:boolean;discoveryWorkReady?:boolean;discoveryBlocker?:string|null;spendingActivationAvailable?:boolean;contactWorkReady?:boolean;contactQuote?:{chargeCents:number;maxContacts:number}|null;discoveryQuote?:{chargeCents:number;maxProperties:number}|null;balanceCents?:number;activeWork?:boolean;identity?:unknown}){
 if(a.billingModel==='membership_credits'&&!a.membershipActive)return {label:'SUBSCRIPTION',title:'Your software access needs attention.',detail:'Open your subscription settings. Your saved work and credit balance remain here.'};
 if(a.billingReview)return {label:'PAYMENT REVIEW',title:'Your payment needs a review.',detail:'New work is paused. Your saved work remains available.'};
 if(!a.identity)return {label:'NEEDS YOU',title:'Add your contract name.',detail:'Add your full legal name or company so agreements use the correct buyer.'};
 const blocker=!a.workReady&&!a.discoveryWorkReady&&!a.contactWorkReady&&!a.smsWorkReady&&!a.activeWork?discoveryBlockerMessage(a.discoveryBlocker):null;
 if(blocker&&a.discoveryBlocker==='spending_activation_required'&&a.spendingActivationAvailable===true)return {label:'NEEDS YOU',title:'Review your bot’s spending limit.',detail:'Review and authorize the paid-credit limit below. Saving does not start your bot; Start remains a separate action.'};
 if(blocker)return {label:'SETUP PENDING',title:blocker.title,detail:blocker.detail};
 if(a.paused)return {label:'PAUSED',title:'Your bot is paused.',detail:'Your opportunities and conversations are saved.'};
 if((a.balanceCents??0)<=0)return {label:'NO AVAILABLE CREDITS',title:'Your available credits are used up.',detail:'No new paid work can start without available credits.'};
 if(!a.workReady&&a.contactWorkReady)return {label:'CONTACT LOOKUP READY',title:'Owner contact lookup is ready.',detail:'Lookups are limited to financially screened properties and your account budget. Contact details do not grant outreach permission; AI calls remain held.'};
 if(!a.workReady&&a.discoveryWorkReady)return {label:a.activeWork?'WORKING':'DISCOVERY READY',title:a.activeWork?'Your bot is screening properties.':'Property discovery is ready.',detail:a.smsWorkReady?'Property discovery and eligible SMS can start. Owner contact lookups and AI calls remain held.':'Property discovery can start. Owner contact lookups, outreach and AI calls remain held.'};
 if(!a.workReady&&a.smsWorkReady)return {label:'SMS READY',title:'SMS outreach is ready for eligible contacts.',detail:'Only SMS can start. AI calls, invitations and contracts remain held.'};
 if(!a.workReady)return {label:'SETUP PENDING',title:'Your bot is awaiting live setup.',detail:'Live acquisition is still being configured. Your saved work is below.'};
 if(a.activeWork)return {label:'WORKING',title:'Your bot is working.',detail:'Open an opportunity below to see the numbers and conversations.'};
 return {label:'READY',title:'Ready for the next eligible task.',detail:'Your bot is waiting for work that passes contact, timing and budget checks.'};
}

/** One navigation/action hint, derived only from verified current status. Never grants authority. */
export function workspaceNextAction(a:{billingModel?:string;membershipActive?:boolean;billingReview?:boolean;paused?:boolean;workReady?:boolean;smsWorkReady?:boolean;discoveryWorkReady?:boolean;discoveryBlocker?:string|null;spendingActivationAvailable?:boolean;contactWorkReady?:boolean;contactQuote?:{chargeCents:number;maxContacts:number}|null;discoveryQuote?:{chargeCents:number;maxProperties:number}|null;balanceCents?:number;activeWork?:boolean;identity?:unknown},campaign:{mode?:'outbound_voice_sms'|'sms_inbound'|null;configured:boolean;released:boolean;liveWorkReady:boolean;smsChannelEnabled?:boolean;policy:{version:string};acknowledgment:{version:string}|null}|null){
 if(a.billingModel==='membership_credits'&&!a.membershipActive)return {kind:'membership' as const,label:'Manage software access',reason:'Check your subscription before starting new paid work.'};
 if(a.billingReview)return {kind:'support' as const,label:'Get help with payment',reason:'A payment review is holding new work.'};
 if(!a.identity)return {kind:'identity' as const,label:'Add my contract name',reason:'Add your legal name or company before your bot can work.'};
 if(a.activeWork&&!a.paused)return {kind:'pause' as const,label:'Pause bot',reason:'Work is in progress. Pause here to stop new AI work. Your software subscription is managed separately.'};
 if(!a.workReady&&a.contactWorkReady){
  const withSms=a.smsWorkReady===true&&campaign?.configured===true&&campaign.released===true&&campaign.smsChannelEnabled===true&&campaign.acknowledgment?.version===campaign.policy.version;
  const quote=a.contactQuote?`Up to ${a.contactQuote.maxContacts} owner-associated people per lookup with a $${(a.contactQuote.chargeCents/100).toFixed(2)} planning reservation. `:'';
  return a.paused?{kind:'resume' as const,label:withSms?'Start contact lookup & SMS':'Start contact lookup',reason:quote+(withSms?'Eligible SMS can also run under the released campaign. Wallet and account spending limits still apply.':'Wallet and account spending limits apply. This starts eligible data work; contact details do not authorize outreach.')}
   :{kind:'work' as const,label:'View current work',reason:'Eligible contact lookups can run within your account limits. Outreach permissions and AI call holds are unchanged.'};
 }
 if(!a.workReady&&a.discoveryWorkReady){
  const withSms=a.smsWorkReady===true&&campaign?.released===true&&campaign.smsChannelEnabled===true;
  const quote=a.discoveryQuote?`Up to ${a.discoveryQuote.maxProperties} properties per page at a $${(a.discoveryQuote.chargeCents/100).toFixed(2)} planning charge. `:'';
  return a.paused?{kind:'resume' as const,label:withSms?'Start discovery & SMS':'Start discovery',reason:quote+(withSms?'Eligible SMS can also start. Wallet and spending limits still apply; owner contact lookups and AI calls remain held.':'Wallet and spending limits still apply. Owner contact lookups, outreach and AI calls remain held.')}
   :{kind:'work' as const,label:'View current work',reason:'Property discovery is ready for the next budget-eligible page. Open saved screening results below.'};
 }
 const blocker=!campaign?.smsChannelEnabled&&!a.workReady&&!a.discoveryWorkReady&&!a.contactWorkReady&&!a.smsWorkReady&&!a.activeWork?discoveryBlockerMessage(a.discoveryBlocker):null;
 if(blocker&&a.discoveryBlocker==='spending_activation_required'&&a.spendingActivationAvailable===true)return {kind:'activation' as const,label:'Review spending activation',reason:'Your paid-credit spending review is available below. Review and accept the limit; Start remains a separate action.'};
 if(blocker&&a.discoveryBlocker==='available_credits_required')return {kind:'funding' as const,label:'Review funding',reason:blocker.detail};
 if(blocker)return {kind:'support' as const,label:'Get setup help',reason:blocker.detail};
 if(!campaign)return {kind:'campaign' as const,label:'Check outreach status',reason:'Verify campaign status before starting.'};
 if(!campaign.configured||campaign.acknowledgment?.version!==campaign.policy.version)return {kind:'campaign' as const,label:'Choose outreach channels',reason:'Choose outbound AI calls + SMS or SMS with inbound-call invitations, then save your account’s responsibilities.'};
 if(!campaign.released)return {kind:'campaign' as const,label:'Confirm outreach channels',reason:'Review your selected channels and sending business, then save to complete account setup.'};
 const smsOnly=(campaign.mode==='sms_inbound'||!a.workReady)&&a.smsWorkReady===true&&campaign.smsChannelEnabled===true;
 const inboundMode=campaign.mode==='sms_inbound'&&campaign.liveWorkReady&&a.workReady;
 if(!smsOnly&&(!campaign.liveWorkReady||!a.workReady))return {kind:'campaign' as const,label:'View setup status',reason:'Required setup checks are pending. Review the status; funding does not clear them.'};
 if((a.balanceCents??0)<=0)return {kind:'funding' as const,label:'Review funding',reason:'Add prepaid work credits. Review the one-time amount before paying.'};
 if(a.paused)return {kind:'resume' as const,label:smsOnly?'Start SMS outreach':'Start bot',reason:smsOnly?inboundMode?'Start eligible SMS and inbound-call invitations. Outbound AI calls stay off; contact, provider, timing and budget checks still apply.':'Start eligible SMS only. Contact, timing and budget checks still apply; AI calls remain held.':'Setup checks are ready. Start your bot; contact and timing checks still apply.'};
 return {kind:'work' as const,label:'View current work',reason:smsOnly?inboundMode?'SMS and inbound-call invitations can run when their setup and contact checks pass. Outbound AI calls stay off.':'SMS is ready for eligible contacts. AI calls and invitations remain held.':'Your bot is ready for eligible tasks. Open your saved work below.'};
}

export function workspaceActionDisabled(kind:ReturnType<typeof workspaceNextAction>['kind'],busy:boolean,accountError:boolean){
 return busy||(accountError&&kind!=='pause');
}
