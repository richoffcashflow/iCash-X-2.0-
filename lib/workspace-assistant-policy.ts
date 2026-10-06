import type {ActivityReport} from './activity-report';
export const assistantIntents=['report','offer','property','next','balance','status','pause','resume','help'] as const;
export type AssistantIntent=typeof assistantIntents[number];
export type AssistantProperty={id:string;address:string;offer:string;arv:string;repairs:string;fee:string;currentCalculation:boolean;stage:string;next:string;summary:string|null;practice:boolean};
export type AssistantContext={checkedAt:string;report:ActivityReport;paused:boolean;balanceCents:number;task:string;active:boolean;needsYou:boolean;properties:AssistantProperty[];selectedId:string|null;hasMore:boolean};
export type AssistantAction={kind:'property'|'attention'|'funding'|'pause'|'resume'|'support';label:string;screeningId?:string};
export type AssistantAnswer={text:string;actions:AssistantAction[];checkedAt:string;propertyId:string|null};
export function localAssistantIntent(question:string):AssistantIntent{
 const q=question.toLowerCase();
 if(/\b(pause|stop)\b.*\b(bot|work|everything)\b|^pause$/.test(q))return 'pause';
 if(/\b(resume|start|run)\b.*\b(bot|work)\b/.test(q))return 'resume';
 if(/offer|arv|repair|calculation|numbers|wholesale fee/.test(q))return 'offer';
 if(/credit|balance|recharge|add money|fund/.test(q))return 'balance';
 if(/today|yesterday|this week|7 days|30 days|report|how many|happened/.test(q))return 'report';
 if(/next|need me|needs me|need you|attention|should i do|priority/.test(q))return 'next';
 if(/running|doing|working|status|why.*(paused|stopped)|nothing/.test(q))return 'status';
 if(/property|seller|buyer|contract|closing|title/.test(q))return 'property';
 return 'help';
}
export function answerWorkspaceQuestion(intent:AssistantIntent,c:AssistantContext,selectedId:string|null):AssistantAnswer{
 const p=c.properties.find(p=>p.id===(c.selectedId??selectedId));
 const open=(p:AssistantProperty):AssistantAction=>({kind:'property',label:p.address,screeningId:p.id});
 const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c.balanceCents/100);
 let text='',actions:AssistantAction[]=[];
 if(intent==='report'){
  const r=c.report,period=r.days===1?'Today':`Over the last ${r.days} days`;
  text=`${period}: ${r.leads} new lead${r.leads===1?'':'s'}, ${r.calls} call${r.calls===1?'':'s'}, ${r.texts} text${r.texts===1?'':'s'}, and ${r.contracts} signed seller contract${r.contracts===1?'':'s'}.`;
  if(!r.leads&&!r.calls&&!r.texts&&!r.contracts)text+=' No activity is recorded for this period yet.';
  if(c.needsYou){text+=' A saved request needs your attention.';actions=[{kind:'attention',label:'Review request'}];}
 }else if(intent==='offer'){
  if(p){text=`${p.address}\n\nCash offer price: ${p.offer}\nARV: ${p.arv}\nEstimated repairs: ${p.repairs}`;
   if(p.currentCalculation)text+=`\nWholesale fee: ${p.fee}\n\n(ARV − repairs) × 70% − wholesale fee. This is the saved estimate, not an accepted offer.`;
   else text+='\n\nThe saved inputs do not contain a verified current calculation. Review the deal numbers before making an offer.';
   actions=[open(p)];
  }else{text='Which property should I explain? Choose one below, or use Ask bot on its card.';actions=c.properties.slice(0,3).map(open);}
 }else if(intent==='balance'){
  text=`You have ${money} in available credits. Add $10, $25, $50, or a custom amount whenever you want. Recharges are manual. Credits fund eligible work; the $50 monthly subscription is separate.`;actions=[{kind:'funding',label:'Add money'}];
 }else if(intent==='pause'||intent==='resume'){
  text=intent==='pause'?(c.paused?'Your bot is already paused.':'Use Pause bot below to stop new automated work. Previously started work may finish.'):(c.balanceCents<=0?'Add money before starting your bot.':c.paused?'Use Run bot below to resume eligible work.':'Your bot is already enabled. It will work when an eligible task is available.');
  actions=intent==='pause'?(c.paused?[]:[{kind:'pause',label:'Pause bot'}]):c.balanceCents<=0?[{kind:'funding',label:'Add money'}]:c.paused?[{kind:'resume',label:'Run bot'}]:[];
 }else if(intent==='status'){
  text=c.paused?'Your bot is paused. Your saved properties and conversations are still here.':c.balanceCents<=0?'Your bot needs credits before it can start new paid work.':c.active?`Your bot is ${c.task.charAt(0).toLowerCase()+c.task.slice(1)}.`:'Your bot is enabled and waiting for its next eligible task. No task is currently recorded as running.';
  actions=c.balanceCents<=0?[{kind:'funding',label:'Add money'}]:c.paused?[{kind:'resume',label:'Run bot'}]:[];
 }else if(intent==='next'){
  if(c.needsYou){text='Start with the saved requests in Needs you. Review the conversation or agreement before continuing.';actions=[{kind:'attention',label:'Review request'}];}
  else if(c.balanceCents<=0){text='Add money to start eligible bot work. You can still review your saved property numbers and conversations.';actions=[{kind:'funding',label:'Add money'}];}
  else if(c.paused){text='Your next step is to resume the bot when you’re ready.';actions=[{kind:'resume',label:'Run bot'}];}
  else if(p??c.properties[0]){const first=p??c.properties[0];text=`${first.address}\n\n${first.next}`;actions=[open(first)];}
  else text='Your bot is enabled. New properties and completed work will appear here when available.';
 }else if(intent==='property'){
  if(p){text=`${p.address}\n\n${p.stage}. ${p.next}${p.summary?'\n\nLatest saved seller call: '+p.summary:''}`;actions=[open(p)];}
  else{text='Choose a property to review its numbers, seller conversations, or progress toward closing.';actions=c.properties.slice(0,3).map(open);}
 }else{text='I can check what your bot is doing, summarize activity, explain a property’s cash offer, and show what needs your attention. Try “What happened today?” or choose a property below.';actions=c.properties.slice(0,2).map(open);}
 if(p?.practice)text='Practice property · no live deal\n\n'+text;
 return {text,actions,checkedAt:c.checkedAt,propertyId:p?.id??null};
}
