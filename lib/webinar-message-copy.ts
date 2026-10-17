export type MessagePhase='resume'|'next'|'checkout'|'vip';
const clean=(value:string,length:number)=>value.replace(/[\r\n\t]+/g,' ').trim().slice(0,length);
export function campaignCopy({name,brand,host,phase,title,step,reply=false}:{name:string;brand:string;host:string;phase:MessagePhase;title:string;step:number;reply?:boolean}){
 const first=clean(name,80).split(/\s+/)[0]||'there';
 const index=step>=300000&&step<=300002?step-300000:Math.abs(step)%3;
 const variants:[string,string,string][]=[
  ['Your webinar link','Want to keep watching? Open your webinar below to continue the walkthrough.','Want to keep watching? Your webinar link:'],
  ['See the rest of the walkthrough','Still interested in how the software works? Come back to the webinar and see the workflow before deciding.','Want to see the rest of the walkthrough? Open your webinar:'],
  ['One last webinar reminder','Here is your webinar link if you would like another look. This is the last automatic reminder in this sequence.','One last webinar reminder. Take another look here:'],
 ];
 const recovery=step>=400000&&step<=400021;
 const final=recovery&&step%10===1;
 const [subject,message,sms]=phase==='vip'?[final?'Your VIP session link':'Join your VIP session',final?'Here is one last reminder to open the VIP session paired with your purchase. Watch whenever you are ready.':'Your purchase is confirmed. Open your VIP session below to join and watch.','Your purchase includes a VIP webinar. Join and watch here:']:
 reply?['Here is your webinar link','Thanks for getting back to us. Open your webinar below.','Here is the webinar link you requested:']:
 phase==='checkout'?[final?'One last checkout reminder':'Your checkout link',final?'Here is one last link to your unfinished checkout. Review the current price and terms whenever you are ready.':'If you would like to continue, open your checkout below and review the current price and terms.','Want to finish checking out? Review your plan here:']:
 recovery?[final?'One last webinar reminder':'Come back to your webinar',final?'Still want to watch? Here is your webinar link again. This is the last reminder for this visit.':'You can come right back and keep watching. Open your webinar below.',final?'One last reminder to keep watching. Join your webinar:':'Come back and keep watching. Join your webinar:']:
 phase==='next'?['Another webinar to explore',`You can take another look at the software in the webinar below.${title?`\n\nSession: ${clean(title,160)}`:''}`,'Take another look at the software in this webinar:']:variants[index];
 const cta=phase==='vip'?'Join my VIP session':phase==='checkout'?`Review ${brand} access`:'Join my webinar';
 return {subject:clean(subject,150),body:`Hey ${first},\n\n${message}\n\n${cta}:`,signature:`— ${host}`,sms:`Hey ${first}, ${brand} here. ${sms}`};
}
export function campaignReason(step:number,reply=false){
 if(reply)return 'Send the requested join link immediately, at any hour.';
 if(step>=400000&&step<=400021)return step%10===1?'One final reminder 15 minutes after the first accepted send, only if they have not returned.':'Send immediately after departure or verified purchase without VIP attendance, at any hour.';
 if(step>=300000&&step<=300002)return ['First reminder after at least 15 minutes away.','Second reminder, no earlier than the next day.','Final reminder, planned three days after signup.'][step-300000];
 return 'Earlier reminder sequence; unsent automatic messages expire within seven days.';
}
