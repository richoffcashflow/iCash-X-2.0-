import {safeTextReplies} from './text-ai-policy.ts';
export type TextProperty={address:string;fetchedAt:string;ceilingCents:number|null;titleReview:boolean};
/** These questions do not quote an offer, accept terms, or authorize a contract. */
export function propertyQuestionAllowed(action:string,property:TextProperty|null,messages:{direction:string;body:string}[],now=Date.now()){
 if(!['ask_flexibility','ask_payoff'].includes(action))return true;
 if(!property||!Number.isFinite(Date.parse(property.fetchedAt))||Date.parse(property.fetchedAt)>now||now-Date.parse(property.fetchedAt)>86400000)return false;
 const reply=safeTextReplies[action as keyof typeof safeTextReplies];
 if(messages.some(m=>m.direction==='outgoing'&&reply&&m.body.includes(reply)))return false;
 if(action==='ask_payoff')return property.titleReview;
 return property.ceilingCents!==null&&Number.isSafeInteger(property.ceilingCents)&&property.ceilingCents>0;
}
