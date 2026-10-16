import type {SupportTransport} from '@/lib/support-client';

export const supportScenarios=[
 {id:'bot',label:'Bot paused',draft:'Why is my bot paused?'},
 {id:'payment',label:'Payment question',draft:'I paid but my credit is missing.'},
 {id:'recovery',label:'Interrupted connection',draft:'Why did my bot stop working?'},
] as const;
export type SupportScenario=typeof supportScenarios[number]['id'];

/** Isolated, per-preview memory. No fetch, account data or real actions. */
export function createSupportPreview(scenario:SupportScenario):SupportTransport{
 const messages:{id:string;role:string;content:string;created_at:string}[]=[];
 const receipts=new Map<string,string>();let status='open',interrupted=false;
 const threadId='preview-thread';
 const add=(role:string,content:string)=>messages.push({id:`preview-${messages.length}`,role,content,created_at:new Date().toISOString()});
 return async(path,init={})=>{
  if(path==='/api/support/cancel')return Response.json({error:'This is a sample conversation. Membership changes are unavailable in the preview.'},{status:400});
  if(path.split('?')[0]!=='/api/support')return Response.json({error:'This action is unavailable in the preview.'},{status:400});
  if(init.method!=='POST')return Response.json({threads:messages.length?[{id:threadId,subject:'Sample conversation',status}]:[],threadId:messages.length?threadId:null,messages,cancellations:[]});
  const input=JSON.parse(String(init.body));
  if(input.action==='escalate'){
   if(status!=='escalated'){status='escalated';add('system','Preview: this conversation would be sent to the support team. No real request has been sent.');}
   return Response.json({escalated:true});
  }
  if(receipts.has(input.requestId))return Response.json({threadId,replay:true});
  if(typeof input.message!=='string')return Response.json({error:'Write a message first.'},{status:400});
  add('user',input.message);receipts.set(input.requestId,input.message);
  const question=input.message.toLowerCase();
  if(/human|person|team/.test(question))add('assistant','Choose “Ask the team” below to send them this conversation. Their reply will appear here.');
  else if(/cancel|refund/.test(question))add('assistant','Open Chat options (•••), then Manage cancellation to review and confirm. Chat messages alone do not cancel anything. Ask the team for refunds or account deletion.');
  else if(/pay|credit|charg/.test(question))add('assistant','A recorded paid payment has not yet been marked as credited. Ask the team to reconcile this recorded payment. Do not make another payment to replace missing credit.');
  else if(/bot|pause|work/.test(question))add('assistant','Your bot is paused. New automated work is stopped; previously authorized work may still finish. The pause flag alone does not tell us why it was paused.\n\nOpen your workspace to review the pause. Resume only when you want new authorized work to run. If you did not pause it, ask the team before resuming.');
  else add('assistant','Hey, I’m James, your iCash X AI support assistant. What can I help you with—your bot, billing, or a property?');
  if(scenario==='recovery'&&!interrupted){interrupted=true;throw Error('The connection was interrupted. Your draft is still here. Refresh status or retry the same message.');}
  return Response.json({threadId});
 };
}
