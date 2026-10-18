export type BuyerOutreachStatus={automatic:true;candidates:number;smsContacts:number;smsReadyNow:number;intakePending:number;requestedEmails:number;textsAccepted:number;emailsAccepted:number;blockers:string[]};

/** Explain observed state without equating purchased records with sendable buyers. */
export function buyerOutreachMessage(status?:BuyerOutreachStatus|null,networkMatches=0){
 if(!status)return null;
 const reasons:Record<string,string>={owner_hold:'Buyer outreach is paused for this deal.',account_paused:'Buyer outreach will resume when the bot is running.',property_paused:'Buyer outreach is paused while you manage this property.',membership_required:'Buyer outreach is waiting for active membership.',credits_required:'Buyer outreach is waiting for work credits.',buyer_reserved:'Buyer outreach has stopped because this property is reserved.',signed_package_required:'Buyer outreach is waiting for a valid signed deal package.',sms_disabled:'Buyer texting is disabled in this account’s saved settings.'};
 const blocked=status.blockers.find(reason=>reason in reasons);
 if(blocked)return reasons[blocked];
 const sent=status.textsAccepted+status.emailsAccepted;
 if(sent)return `${sent} buyer ${sent===1?'package accepted':'packages accepted'} for delivery.`;
 if(networkMatches>0)return null;
 if(status.smsContacts>0)return status.smsReadyNow>0?'Buyer outreach is queued automatically.':'Buyer texts are waiting for the recipient’s contact hours.';
 if(status.requestedEmails>0)return 'Requested buyer packages are queued automatically.';
 if(status.candidates>0)return `${status.candidates} buyer prospects found. No permitted text contacts or package email requests are available yet.`;
 return 'No contactable buyers have been found yet.';
}
