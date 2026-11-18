/** Public task labels only. Never expose prompts, hidden reasoning, or contact data. */
export const botTaskLabels:Record<string,string>={
 discovery:'Finding eligible properties',market_research:'Checking property availability',contacts:'Finding property owners',
 seller_opener:'Contacting an owner',seller_recovery:'Following up with a seller',text_ai:'Preparing a reply',voice_dispatch:'Starting a call',
 voice_result:'Updating a conversation',signing_result:'Checking a signature',signing_receipt:'Checking a signature',fulfillment:'Preparing deal documents',
 title_followup:'Following up with title',customer_updates:'Sending an update',customer_attention:'Sending an update',
};
export type BotBlockedReason='no_completed_work'|'configuration_expired'|'configuration_disabled'|'system_paused'|'unknown';
export type BotActivity={active:boolean;label:string;checkedAt:string;blocked?:boolean;blockedReason?:BotBlockedReason;unavailable?:boolean;pendingConfirmation?:boolean;ownerCheckComplete?:boolean};
export type OwnerCheckTicket={kind:string;state:string;outcome:string|null;created_at:string;completed_at:string|null};
export const ownerCheckWindowMs=30*60*1000;

export function recentOwnerCheckLabel(ticket:OwnerCheckTicket|undefined,checkedAt:string):string|null{
 if(ticket?.kind!=='contacts'||ticket.state!=='complete'||!ticket.completed_at)return null;
 const started=Date.parse(ticket.created_at),finished=Date.parse(ticket.completed_at),now=Date.parse(checkedAt);
 if(!(started>=now-ownerCheckWindowMs&&started<=finished&&finished<=now))return null;
 if(ticket.outcome==='empty')return 'An owner lookup finished without a contact for the property it checked. Earlier work costs are under review.';
 if(ticket.outcome==='contacts_saved')return 'An owner lookup finished and saved its results. Earlier work costs are under review.';
 return null;
}

function blockedReason(reason:string|undefined):BotBlockedReason{
 switch(reason){
  case 'no_completed_work':case 'configuration_expired':case 'configuration_disabled':case 'system_paused':return reason;
  default:return 'unknown';
 }
}
export function currentBotActivity(input:{paused:boolean;tickets:{kind:string;state:string;expires_at:string}[];screening:{state:string;lease_until:string|null}[];progress?:{status?:string;callsBudgetHeld?:number;health?:{status:string;reason?:string}}|null},now=Date.now()):BotActivity{
 const checkedAt=new Date(now).toISOString();
 if(input.paused)return {active:false,label:'Paused',checkedAt};
 const health=input.progress?.health;
 if(health?.status==='unavailable')return {active:false,label:'Work status is temporarily unavailable',checkedAt,unavailable:true};
 // An unresolved original does not establish whether another task is active.
 // Preserve that observation alongside actual task evidence, without clearing it.
 const pendingConfirmation=health?.status==='blocked'&&health.reason==='pending_work';
 if(health?.status==='blocked'&&!pendingConfirmation)return {active:false,blocked:true,blockedReason:blockedReason(health.reason),checkedAt,label:health.reason==='no_completed_work'?'No recent completed task was recorded.':'A service issue is blocking work on your account.'};
 const pending=pendingConfirmation?{pendingConfirmation:true}:{};
 const ticket=input.tickets.find(t=>t.state==='consumed'&&Date.parse(t.expires_at)>now&&Object.hasOwn(botTaskLabels,t.kind));
 if(ticket)return {active:true,label:botTaskLabels[ticket.kind],checkedAt,...pending};
 if(input.screening.some(s=>s.state==='running'&&s.lease_until&&Date.parse(s.lease_until)>now))return {active:true,label:'Checking property numbers',checkedAt,...pending};
 if(pendingConfirmation)return {active:false,label:'Earlier work is awaiting confirmation.',checkedAt,...pending};
 if(input.progress?.status==='budget_reached')return {active:false,label:'Waiting for available credits',checkedAt};
 if(input.progress?.status==='settling')return {active:false,label:'Confirming earlier work costs',checkedAt};
 if(input.progress?.status==='paced')return {active:false,label:'Waiting for eligible work',checkedAt};
 return {active:false,label:'Waiting for the next task',checkedAt};
}
