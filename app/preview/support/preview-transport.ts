import type {SupportTransport} from '@/lib/support-client';
import {supportGreeting,supportCancellationReply,supportTeamReply,supportEvidenceReply} from '../../../lib/support-copy.ts';

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
  const sample=(key:string,code:string)=>supportEvidenceReply({key,code,status:'attention',source:'preview',detail:'',observedAt:new Date().toISOString()});
  if(/human|person|team/.test(question))add('assistant',supportTeamReply);
  else if(/cancel|refund/.test(question))add('assistant',supportCancellationReply);
  else if(/pay|credit|charg/.test(question))add('assistant',sample('payments','payment_uncredited'));
  else if(/bot|pause|work/.test(question))add('assistant',sample('work','paused'));
  else add('assistant',supportGreeting);
  if(scenario==='recovery'&&!interrupted){interrupted=true;throw Error('The connection was interrupted. Your draft is still here. Refresh status or retry the same message.');}
  return Response.json({threadId});
 };
}
