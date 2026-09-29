import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const phone = z.string().regex(/^\+[1-9]\d{7,14}$/);
const leases = z.object({object:z.literal('response'),data:z.object({numbers:z.array(z.object({
  number:z.object({e164:phone}),lease_status:z.string(),capabilities:z.object({channels:z.array(z.string())})
}))})});
type Transport = typeof fetch;
/** Server-side only. Never forward provider bodies or credentials to a client/log. */
async function request(key:string,path:string,fetcher:Transport,body?:unknown) {
  if(!key.trim()) throw new Error('CONTIGUITY_KEY_MISSING');
  let response:Response;
  try { response=await fetcher(`https://api.contiguity.com${path}`,{
    method:body===undefined?'GET':'POST',headers:{Authorization:`Token ${key}`,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)
  }); } catch { throw new Error(body===undefined?'CONTIGUITY_UNREACHABLE':'CONTIGUITY_SEND_UNKNOWN_DO_NOT_RETRY'); }
  if(!response.ok) throw new Error(`CONTIGUITY_HTTP_${response.status}`);
  try {return await response.json();}catch{throw new Error(body===undefined?'CONTIGUITY_INVALID_RESPONSE':'CONTIGUITY_SEND_UNKNOWN_DO_NOT_RETRY');}
}
export async function contiguityPreflight(key:string,fetcher:Transport=fetch) {
  const parsed=leases.safeParse(await request(key,'/numbers/leased',fetcher));
  if(!parsed.success) throw new Error('CONTIGUITY_INVALID_RESPONSE');
  const active=parsed.data.data.numbers.filter(n=>n.lease_status==='active'&&n.capabilities.channels.includes('imessage'));
  return {authenticated:true,leasedNumbers:parsed.data.data.numbers.length,activeIMessageNumbers:active.length,
    messagingEnabled:false,smsFallback:false};
}
export function iMessagePayload(input:unknown) {
  const v=z.object({from:phone,to:phone,message:z.string().trim().min(1).max(4000)}).strict().parse(input);
  return {...v,fallback:{when:[]},fast_track:false};
}
/** Test-only transport. No production outreach entry point exists yet. No automatic retry. */
export async function sendContiguityTest(input:unknown,env:Record<string,string|undefined>=process.env,fetcher:Transport=fetch){
  if(env.ICASH_CONTIGUITY_TEST_SEND!=='true')throw new Error('CONTIGUITY_TEST_DISABLED');
  const payload=iMessagePayload(input);
  if(!env.CONTIGUITY_TEST_TO||payload.to!==env.CONTIGUITY_TEST_TO||payload.from!==env.CONTIGUITY_FROM)
    throw new Error('CONTIGUITY_TEST_ADDRESS_NOT_ALLOWED');
  const result=await request(env.CONTIGUITY_API_KEY??'','/send/imessage',fetcher,payload);
  const parsed=z.object({object:z.literal('response'),data:z.object({message_id:z.string().min(1)})}).safeParse(result);
  if(!parsed.success)throw new Error('CONTIGUITY_SEND_UNKNOWN_DO_NOT_RETRY');
  return {messageId:parsed.data.data.message_id,status:'accepted' as const}; // NOT delivery confirmation
}
export function verifyContiguityWebhook(raw:Buffer,header:string|null,secret:string,now=Date.now()):boolean {
  if(!secret||!header||raw.length>262144||!Number.isFinite(now))return false;
  const m=/^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(header.trim());
  if(!m||Math.abs(Math.floor(now/1000)-Number(m[1]))>300)return false;
  const expected=createHmac('sha256',secret).update(m[1]+'.').update(raw).digest();
  return timingSafeEqual(expected,Buffer.from(m[2],'hex'));
}

export function textPayload(input:unknown){
 return z.object({from:phone,to:phone,message:z.string().trim().max(1000),attachments:z.array(z.string().url().refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&/\.(jpg|jpeg|png|webp|pdf)$/i.test(u.pathname);})).max(3).default([])}).strict().refine(v=>v.message.length>0||v.attachments.length>0).transform(v=>({...v,fast_track:false})).parse(input);
}
/** Called only after a durable, funded one-use database claim. No provider retries. */
export async function sendContiguityText(input:unknown,key:string,fetcher:Transport=fetch){
 const payload=textPayload(input);const result=await request(key,'/send/text',fetcher,payload);
 const parsed=z.object({object:z.literal('response'),data:z.object({message_id:z.string().min(1).max(200)})}).safeParse(result);
 if(!parsed.success)throw Error('CONTIGUITY_SEND_UNKNOWN_DO_NOT_RETRY');
 return {messageId:parsed.data.data.message_id,status:'accepted' as const};
}
export function isMessageOptOut(text:string){
 return /^(stop|stopall|unsubscribe|cancel|end|quit|revoke|opt\s*out)[.!\s]*$/i.test(text.trim())||/^(please\s+)?(unsubscribe|remove|delete)\s+me[.!\s]*$/i.test(text.trim())||/\b(do not|don't|dont|stop)\s+(texting|messaging|contacting|text|message|contact)\s*(me|us)?\b/i.test(text)||/\b(remove|take)\s+me\s+(off|from)\b/i.test(text);
}
const messageEvent=z.object({id:z.string().min(1).max(200),type:z.string().min(1).max(100),timestamp:z.number().finite(),data:z.object({from:phone,to:phone,body:z.string().max(20000).optional(),message_id:z.string().max(200).optional(),attachments:z.array(z.object({url:z.string().url().max(3000),mime:z.string().max(150).optional(),filename:z.string().max(250).optional()})).max(20).optional()})});
export function parseTextWebhook(input:unknown){
 const envelope=z.object({type:z.string(),data:z.unknown()}).passthrough().parse(input);
 if(envelope.type==='numbers.substitution'){
  const d=z.object({original_number:phone,used_number:phone,message_id:z.string().min(1).max(200)}).parse(envelope.data);
  input={...envelope,data:{from:d.original_number,to:d.used_number,message_id:d.message_id}};
 }
 const event=messageEvent.parse(input);
 if(!['text.incoming.sms','text.incoming.mms','text.delivery.confirmed','text.delivery.failed','text.cancelled','numbers.substitution'].includes(event.type))throw Error('Unsupported text event');
 if(event.type.startsWith('text.incoming')&&event.data.body===undefined&&!event.data.attachments?.length)throw Error('Empty incoming message');
 if(!event.type.startsWith('text.incoming')&&!event.data.message_id)throw Error('Missing message ID');
 return {...event,optOut:event.type.startsWith('text.incoming')&&isMessageOptOut(event.data.body??'')};
}
