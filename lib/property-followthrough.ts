import {journeyNextAction,type JourneyProgress} from './deal-journey-progress.ts';
export type SellerReplyStep={message_id:string;thread_id:string;deal_id:string;state:string;reason:string;next_step:string;next_check_at:string|null;updated_at:string};
type Input={paused:boolean;manual:boolean;needsYou:boolean;stage?:string;next:string;screenedAt:string;sellerReply?:{message_id:string;received_at:string};sellerStep?:SellerReplyStep;callAt?:string;journey?:JourneyProgress;callback?:{state:string;due_at:string;timezone:string}};
export function propertyFollowthrough(i:Input){
 const events=[{label:'Property screened',at:i.screenedAt},...(i.sellerReply?[{label:'Seller reply received',at:i.sellerReply.received_at}]:[]),...(i.callAt?[{label:'Seller call completed',at:i.callAt}]:[])].filter(e=>Number.isFinite(Date.parse(e.at))).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 const seller=i.sellerStep?.message_id===i.sellerReply?.message_id&&i.sellerStep?.state!=='superseded'?i.sellerStep:undefined;
 let owner='Bot',next=i.next,checkAt:string|null=null,checkLabel='Next check',timezone:string|undefined;
 if(['cancelled','canceled'].includes(i.stage??''))owner='Stopped';
 else if(i.needsYou||i.manual||i.paused||i.stage==='closed'||i.stage==='cancellation_pending'){
  owner='You';if(i.paused&&!i.needsYou&&!i.manual)next='Your bot is paused. Resume it when you are ready.';
  else if(i.manual&&!i.needsYou)next='You control this property. Continue the conversation or return it to the bot.';
 }else if(i.journey){owner=journeyNextAction(i.journey).waitingOn;next=journeyNextAction(i.journey).detail;}
 else if(i.callback){owner=i.callback.state==='held_for_human'?'You':'Bot';checkAt=i.callback.due_at;checkLabel='Requested callback';timezone=i.callback.timezone;}
 else if(seller){owner=seller.state==='needs_review'?'You':seller.state==='stopped'?'Stopped':seller.reason==='awaiting_seller_reply'?'Seller':'Bot';next=seller.next_step;checkAt=seller.next_check_at;}
 else if(!['under_contract','buyer_selected','assigned','buyer_matched','purchase_signed','assignment_signed'].includes(i.stage??'')){owner='Awaiting update';}
 return {last:events[0]??null,owner,next,checkAt,checkLabel,timezone};
}
