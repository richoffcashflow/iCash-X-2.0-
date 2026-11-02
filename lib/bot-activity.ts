/** Public task labels only. Never expose prompts, hidden reasoning, or contact data. */
export const botTaskLabels:Record<string,string>={
 discovery:'Finding eligible properties',market_research:'Checking property availability',contacts:'Finding property owners',
 seller_opener:'Contacting an owner',seller_recovery:'Following up with a seller',text_ai:'Preparing a reply',voice_dispatch:'Starting a call',
 voice_result:'Updating a conversation',signing_result:'Checking a signature',fulfillment:'Preparing deal documents',
 title_followup:'Following up with title',customer_updates:'Sending an update',customer_attention:'Sending an update',
};
export type BotActivity={active:boolean;label:string;checkedAt:string;blocked?:boolean;unavailable?:boolean};
export function currentBotActivity(input:{paused:boolean;tickets:{kind:string;state:string;expires_at:string}[];screening:{state:string;lease_until:string|null}[];progress?:{status?:string;callsBudgetHeld?:number;health?:{status:string;reason?:string}}|null},now=Date.now()):BotActivity{
 const checkedAt=new Date(now).toISOString();
 if(input.paused)return {active:false,label:'Paused',checkedAt};
 const health=input.progress?.health;
 if(health?.status==='unavailable')return {active:false,label:'Work status is temporarily unavailable',checkedAt,unavailable:true};
 if(health?.status==='blocked')return {active:false,blocked:true,checkedAt,label:health.reason==='pending_work'?'Earlier work is awaiting confirmation. New work is delayed.':health.reason==='no_completed_work'?'Work is delayed. No recent completed task was recorded.':'A service issue is blocking work on your account.'};
 const ticket=input.tickets.find(t=>t.state==='consumed'&&Date.parse(t.expires_at)>now&&Object.hasOwn(botTaskLabels,t.kind));
 if(ticket)return {active:true,label:botTaskLabels[ticket.kind],checkedAt};
 if(input.screening.some(s=>s.state==='running'&&s.lease_until&&Date.parse(s.lease_until)>now))return {active:true,label:'Checking property numbers',checkedAt};
 if(input.progress?.status==='budget_reached')return {active:false,label:'Waiting for available credits',checkedAt};
 if(input.progress?.status==='settling')return {active:false,label:'Confirming earlier work costs',checkedAt};
 if(input.progress?.status==='paced')return {active:false,label:'Waiting for eligible work',checkedAt};
 return {active:false,label:'Waiting for the next task',checkedAt};
}
