export function workspaceStatus(a:{billingReview?:boolean;paused?:boolean;workReady?:boolean;smsWorkReady?:boolean;balanceCents?:number;activeWork?:boolean;identity?:unknown}){
 if(a.billingReview)return {label:'PAYMENT REVIEW',title:'Your payment needs a review.',detail:'New work is paused. Your saved work remains available.'};
 if(!a.identity)return {label:'NEEDS YOU',title:'Add your contract name.',detail:'Add your full legal name or company so agreements use the correct buyer.'};
 if(a.paused)return {label:'PAUSED',title:'Your bot is paused.',detail:'Your opportunities and conversations are saved.'};
 if((a.balanceCents??0)<=0)return {label:'NO AVAILABLE CREDITS',title:'Your available credits are used up.',detail:'No new paid work can start without available credits.'};
 if(!a.workReady&&a.smsWorkReady)return {label:'SMS READY',title:'SMS outreach is ready for eligible contacts.',detail:'Only SMS can start. AI calls, invitations and contracts remain held.'};
 if(!a.workReady)return {label:'SETUP PENDING',title:'Your bot is awaiting live setup.',detail:'Live acquisition is still being configured. Your saved work is below.'};
 if(a.activeWork)return {label:'WORKING',title:'Your bot is working.',detail:'Open an opportunity below to see the numbers and conversations.'};
 return {label:'READY',title:'Ready for the next eligible task.',detail:'Your bot is waiting for work that passes contact, timing and budget checks.'};
}

/** One navigation/action hint, derived only from verified current status. Never grants authority. */
export function workspaceNextAction(a:{billingReview?:boolean;paused?:boolean;workReady?:boolean;smsWorkReady?:boolean;balanceCents?:number;activeWork?:boolean;identity?:unknown},campaign:{configured:boolean;released:boolean;liveWorkReady:boolean;smsChannelEnabled?:boolean;policy:{version:string};acknowledgment:{version:string}|null}|null){
 if(a.billingReview)return {kind:'support' as const,label:'Get help with payment',reason:'A payment review is holding new work.'};
 if(!a.identity)return {kind:'identity' as const,label:'Add my contract name',reason:'Add your legal name or company before your bot can work.'};
 if(a.activeWork&&!a.paused)return {kind:'pause' as const,label:'Stop bot & daily billing',reason:'Work is in progress. Stop here to pause new work and future renewals.'};
 if(!campaign)return {kind:'campaign' as const,label:'Check outreach status',reason:'Verify campaign status before starting.'};
 if(!campaign.configured||campaign.acknowledgment?.version!==campaign.policy.version)return {kind:'campaign' as const,label:'Review campaign responsibilities',reason:'Review and acknowledge the campaign before outreach can start.'};
 if(!campaign.released)return {kind:'campaign' as const,label:'View campaign status',reason:'Campaign release is pending. No customer action can release it here.'};
 const smsOnly=!a.workReady&&a.smsWorkReady===true&&campaign.smsChannelEnabled===true;
 if(!smsOnly&&(!campaign.liveWorkReady||!a.workReady))return {kind:'campaign' as const,label:'View setup status',reason:'Required setup checks are pending. Review the status; funding does not clear them.'};
 if((a.balanceCents??0)<=0)return {kind:'funding' as const,label:'Review funding',reason:'Choose a budget to add available credits. Review billing before paying.'};
 if(a.paused)return {kind:'resume' as const,label:smsOnly?'Start SMS outreach':'Start bot',reason:smsOnly?'Start eligible SMS only. Contact, timing and budget checks still apply; AI calls remain held.':'Setup checks are ready. Start your bot; contact and timing checks still apply.'};
 return {kind:'work' as const,label:'View current work',reason:smsOnly?'SMS is ready for eligible contacts. AI calls and invitations remain held.':'Your bot is ready for eligible tasks. Open your saved work below.'};
}

export function workspaceActionDisabled(kind:ReturnType<typeof workspaceNextAction>['kind'],busy:boolean,accountError:boolean){
 return busy||(accountError&&kind!=='pause');
}
