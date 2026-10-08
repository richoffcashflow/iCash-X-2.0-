export const botUpdateConsentVersion='bot-updates-2026-10-08.1';
export const updateCopy={
 credits_low:{title:'Your bot needs more credits',detail:'Your available credits are running low. Open your workspace to review your balance and add credits for the next eligible work.'},
 lead_assigned:{title:'A seller request is ready',detail:'Open the property to see the request and response status.'},
 response_held:{title:'A seller response needs attention',detail:'The first response is waiting for setup or review. Open the property to continue.'},
 buyer_reply:{title:'A buyer replied',detail:'Open the conversation to review the buyer’s message.'},
 call_complete:{title:'A call result is ready',detail:'Review the saved call outcome and next step.'},
 showing_update:{title:'A showing request changed',detail:'Check the showing status. A proposed time is not confirmed access.'},
 title_reply:{title:'Your title company replied',detail:'Review the title reply and any documents or deadlines requested.'},
 buyer_package:{title:'A buyer package was sent',detail:'The email provider accepted the package. This does not confirm delivery or buyer acceptance.'},
 seller_reply:{title:'A seller replied',detail:'Open the conversation to see their latest message.'},
 contract_signed:{title:'A signed agreement is ready',detail:'Review the completed signing record in your property.'},
 deal_title_open:{title:'Your deal reached title',detail:'Check the title file and remaining closing steps.'},
 deal_closing:{title:'Your deal is in closing',detail:'Review the current closing requirements and deadlines.'},
 deal_closed:{title:'Your deal is marked closed',detail:'Open the closing record and final documents.'},
 research_complete:{title:'Your bot finished property research',detail:'Review the saved findings and available property numbers.'},
 needs_you:{title:'Your bot needs your input',detail:'A saved request is waiting in your workspace.'},
} as const;
export type UpdateKind=keyof typeof updateCopy;
export type UpdateSource={source_key:string;kind:UpdateKind;screening_id:string|null;event_at:string;priority:number};
export type BotUpdatePreferences={email?:string|null;phone?:string|null;emailEnabled:boolean;smsEnabled:boolean;timezone:string;seenAt?:string|null;emailAvailable:boolean;smsAvailable:boolean;emailSuppressed?:boolean};
export type InboxItem={id:string;kind:UpdateKind;screeningId:string|null;createdAt:string;title:string;detail:string;address:string|null};
export function normalizeUpdatePhone(value:string){const clean=value.replace(/[\s().-]/g,'');return /^\d{10}$/.test(clean)?`+1${clean}`:/^1\d{10}$/.test(clean)?`+${clean}`:clean;}
export function customerUpdateConfiguration(env:Record<string,string|undefined>){
 let origin:string|null=null;
 try{const url=new URL(env.ICASH_APP_ORIGIN??'');if(url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash)origin=url.origin;}catch{}
 const sender=env.ICASH_ATTENTION_FROM_EMAIL??env.ICASH_TITLE_FROM_EMAIL??'';
 const address=sender.match(/<([^<>]+)>$/)?.[1]??sender;
 const email=!!(origin&&env.RESEND_API_KEY&&env.RESEND_RECEIVING_WEBHOOK_SECRET&&/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(address));
 const sms=!!(origin&&env.CONTIGUITY_API_KEY&&env.CONTIGUITY_WEBHOOK_SECRET);
 return {origin,from:address,email,sms};
}
