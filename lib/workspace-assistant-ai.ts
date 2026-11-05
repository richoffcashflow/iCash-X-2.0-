import {z} from 'zod';
import {assistantIntents,localAssistantIntent,type AssistantAnswer,type AssistantContext} from './workspace-assistant-policy';
import {coachActions,dealCoachInstructions,type CoachReply} from './workspace-assistant-coach';
const coaching=z.object({recommendation:z.string().min(1).max(900),reason:z.string().max(900),steps:z.array(z.string().min(1).max(350)).max(3),question:z.string().max(350).nullable(),actionKeys:z.array(z.string().max(100)).max(3),draft:z.object({threadId:z.string(),body:z.string().trim().min(1).max(600)}).strict().nullable()}).strict();
const schema=z.object({intent:z.enum(assistantIntents),propertyId:z.string().nullable(),coaching:coaching.nullable()}).strict();
const responseSchema={type:'object',additionalProperties:false,properties:{intent:{type:'string',enum:assistantIntents},propertyId:{type:['string','null']},coaching:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,properties:{recommendation:{type:'string'},reason:{type:'string'},steps:{type:'array',items:{type:'string'}},question:{type:['string','null']},actionKeys:{type:'array',items:{type:'string'}},draft:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,properties:{threadId:{type:'string'},body:{type:'string'}},required:['threadId','body']}]}},required:['recommendation','reason','steps','question','actionKeys','draft']}]}} ,required:['intent','propertyId','coaching']};
/** One metered request produces coaching; facts and executable destinations remain server bound. */
export async function routeWorkspaceQuestion(question:string,context:AssistantContext,previous:{question:string;propertyId:string|null;answer?:AssistantAnswer|null}[],fetcher:typeof fetch=fetch,paid:{before:()=>Promise<boolean>;after:(receipt:{providerId:string|null;usage:unknown})=>Promise<void>}|null=null){
 const local=localAssistantIntent(question);
 const exact=context.properties.find(p=>question.toLowerCase().includes(p.address.toLowerCase().split(',')[0]));
 const fallback={intent:local,propertyId:context.selectedId??exact?.id??null,coaching:null as CoachReply|null,model:null as string|null,providerId:null as string|null,usage:null as unknown,raw:null as string|null};
 const model=process.env.ICASH_SUPPORT_AI_MODEL;
 if(!process.env.OPENAI_API_KEY||!model)return fallback;
 if(paid&&model!=='gpt-4.1-mini')return fallback;
 const content=JSON.stringify({question,selectedProperty:context.selectedId,checkedAt:context.checkedAt,account:{paused:context.paused,availableCreditsCents:context.balanceCents},properties:context.properties.map(p=>({...p,address:p.address.slice(0,300),actions:coachActions(p)})),previous:previous.slice(-4).map(p=>({question:p.question.slice(0,500),propertyId:p.propertyId,answer:p.answer?.text.slice(0,900)??null}))});
 // UTF-8 bytes bound worst-case input tokens, including adversarial multi-byte text.
 // Leave room for system/schema tokens under the existing 32,000 input receipt limit.
 if(new TextEncoder().encode(content+dealCoachInstructions+JSON.stringify(responseSchema)).length>28000)return fallback;
 if(paid&&!await paid.before())throw Error('QUESTION_ALREADY_STARTED');
 let accounted=false,received:{providerId:string|null;usage:unknown}|null=null;
 try{
  const response=await fetcher('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(25000),body:JSON.stringify({model,service_tier:'default',store:false,max_completion_tokens:1200,messages:[{role:'system',content:dealCoachInstructions+'\nReturn strict JSON. Use coaching for advice, negotiations, buyer/seller questions and deal next steps. For report, offer math, balance, status, pause or resume use coaching:null; the server supplies those exact facts. Intent coach means general or deal coaching; property/next may also have coaching. Never treat a question about how to respond to an offer as just a request for a calculator.'},{role:'user',content}],response_format:{type:'json_schema',json_schema:{name:'workspace_deal_coach',strict:true,schema:responseSchema}}})});
  if(!response.ok)return fallback;
  const value=await response.json(),raw=value.choices?.[0]?.message?.content;
  received={providerId:typeof value.id==='string'?value.id:null,usage:value.usage??null};
  if(paid){await paid.after(received);accounted=true;}
  const metadata={model,...received,raw:typeof raw==='string'?raw.slice(0,10000):null};
  let decoded:unknown=null;try{decoded=typeof raw==='string'?JSON.parse(raw):null;}catch{}
  const parsed=schema.safeParse(decoded);
  if(value.choices?.[0]?.finish_reason!=='stop'||!parsed.success)return {...fallback,...metadata};
  const intent=['pause','resume'].includes(local)?local:parsed.data.intent;
  const propertyId=context.selectedId??(context.properties.some(p=>p.id===parsed.data.propertyId)?parsed.data.propertyId:fallback.propertyId);
  // Do not attach advice to an invented/foreign property or change a selected property.
  const bound=parsed.data.propertyId===null?propertyId===null:parsed.data.propertyId===propertyId;
  return {...metadata,intent,propertyId,coaching:bound&&['coach','property','next','help'].includes(intent)?parsed.data.coaching:null};
 }catch{return fallback;}finally{
  // A known usage receipt must never be replaced with an unverified zero after a settlement failure.
  if(paid&&!accounted)await paid.after(received??{providerId:null,usage:null});
 }
}
