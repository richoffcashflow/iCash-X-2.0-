import {createHash} from 'node:crypto';
import type {VoiceUsageDb} from './voice-usage-service.ts';
import type {VoiceCostInput} from './voice-cost-settlement.ts';
/** Exact destinations only: never treat +1 as one tariff. This server-owned snapshot
 * must be reviewed before dispatch. No rates are inferred from null Call.price. */
export type OutboundCarrierRule={kind:'outbound_carrier_estimate';evidenceRef:string;snapshotId:string;
 accountId?:string;accountScope?:'operation_owner';agentId:string;twilioAccountSid:string;from:string;destination?:string;
 reviewedAt:string;validFrom:string;validUntil:string;
 voice:{microsPerMinute:number;rounding:'up';minimumMinutes:number};
 stream:{microsPerMinute:number;rounding:'exact'|'up';minimumMinutes:number;assumption:string};
 source:{kind:'reviewed_destination_allowlist';documentUrl:string;reviewer:string}|{kind:'twilio_pricing_api';allowedCountries:string[];maxMicrosPerMinute:number;policyVersion:string;maxPricingLagSeconds:number}};
export type CarrierEnv={TWILIO_ACCOUNT_SID?:string;TWILIO_AUTH_TOKEN?:string;ELEVENLABS_API_KEY?:string};
type Binding={operation_key:string;conversation_id:string;agent_id?:string;contact_key?:string;created_at:string};
const sid=(s:unknown,prefix:string)=>typeof s==='string'&&new RegExp('^'+prefix+'[a-fA-F0-9]{32}$').test(s);
const phone=(s:unknown)=>typeof s==='string'&&/^\+[1-9][0-9]{7,14}$/.test(s);
const ref=(s:unknown)=>typeof s==='string'&&s.trim().length>=10;
const safe=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
const eq=encodeURIComponent;
export class CarrierUsageUnavailable extends Error {constructor(){super('carrier_usage_unavailable');}}
const unavailable=()=>{throw new CarrierUsageUnavailable();};
export async function outboundCarrierInput(db:VoiceUsageDb,accountId:string,b:Binding,r:OutboundCarrierRule,
 env:CarrierEnv,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<VoiceCostInput>{
 const fail=()=>{throw Error('Bound outbound carrier evidence required');};
 if(typeof window!=='undefined'||!sid(env.TWILIO_ACCOUNT_SID,'AC')||!env.TWILIO_AUTH_TOKEN||!env.ELEVENLABS_API_KEY)fail();
 const created=Date.parse(b.created_at),from=Date.parse(r.validFrom),until=Date.parse(r.validUntil),reviewed=Date.parse(r.reviewedAt);
 if((r.accountScope==='operation_owner'?r.accountId!==undefined:r.accountScope!==undefined||r.accountId!==accountId)||r.agentId!==b.agent_id||r.twilioAccountSid!==env.TWILIO_ACCOUNT_SID||(r.source?.kind==='reviewed_destination_allowlist'&&!phone(r.destination))||!phone(r.from)||!ref(r.snapshotId)||!ref(r.evidenceRef)||![created,from,until,reviewed].every(Number.isFinite)||reviewed>created||from>created||until<=created||from>=until||!safe(r.voice?.microsPerMinute)||r.voice.rounding!=='up'||!safe(r.voice.minimumMinutes)||!safe(r.stream?.microsPerMinute)||!['exact','up'].includes(r.stream.rounding)||!safe(r.stream.minimumMinutes)||!ref(r.stream.assumption))fail();
 if(!/^voice:[0-9a-f-]{36}$/i.test(b.operation_key)||!/^conv_[a-z0-9]+$/i.test(b.conversation_id))fail();
 if(r.source?.kind==='reviewed_destination_allowlist'){if(!ref(r.source.reviewer)||!/^https:\/\//.test(r.source.documentUrl)||createHash('sha256').update(r.destination!).digest('hex')!==b.contact_key)fail();}
 else if(r.source?.kind==='twilio_pricing_api'){if(!ref(r.source.policyVersion)||!Array.isArray(r.source.allowedCountries)||!r.source.allowedCountries.length||!r.source.allowedCountries.every(x=>/^[A-Z]{2}$/.test(x))||!safe(r.source.maxMicrosPerMinute)||!safe(r.source.maxPricingLagSeconds)||r.source.maxPricingLagSeconds<1||r.source.maxPricingLagSeconds>86400)fail();}
 else fail();
 const rows=await db<{provider_call_sid:string;conversation_id:string;state:string}[]>(`icash_voice_jobs?id=eq.${eq(b.operation_key.slice(6))}&account_id=eq.${eq(accountId)}&select=provider_call_sid,conversation_id,state`);
 const j=rows[0];if(rows.length!==1||!j||j.state!=='dispatched'||j.conversation_id!==b.conversation_id||!sid(j.provider_call_sid,'CA'))fail();
 const deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000);
 async function get(url:string,headers:Record<string,string>){
  let res:Response;try{res=await fetcher(url,{method:'GET',headers,redirect:'error',cache:'no-store',credentials:'omit',signal:deadline});}catch{throw new CarrierUsageUnavailable();}
  if([404,408,425,429].includes(res.status)||res.status>=500)unavailable();
  if(!res.ok||(res.url&&res.url!==url))fail();
  // Bound response reads; provider payloads are never logged or placed in evidence.
  const reader=res.body?.getReader();if(!reader)fail();let n=0;const chunks:Uint8Array[]=[];
  try{for(;;){const part=await reader!.read().catch(()=>{throw new CarrierUsageUnavailable();});if(part.done)break;n+=part.value.byteLength;if(n>262144)fail();chunks.push(part.value);}}finally{await reader!.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 const c=await get(`https://api.elevenlabs.io/v1/convai/conversations/${eq(b.conversation_id)}`,{'xi-api-key':env.ELEVENLABS_API_KEY!});
 if(c.conversation_id!==b.conversation_id||c.agent_id!==b.agent_id||c.metadata?.phone_call?.call_sid!==j.provider_call_sid)fail();
 if(c.status!=='done')unavailable();
 const call=await get(`https://api.twilio.com/2010-04-01/Accounts/${r.twilioAccountSid}/Calls/${j.provider_call_sid}.json`,{Authorization:'Basic '+Buffer.from(r.twilioAccountSid+':'+env.TWILIO_AUTH_TOKEN).toString('base64')});
 if(call.from!==r.from){
  // The immutable recording row carries the caller ID receipt captured at
  // admission. Later number retirement must not prevent actual usage settlement.
  if(r.from!=='+14243948384'||call.from!=='+14244377030'||r.source.kind!=='twilio_pricing_api')fail();
  const bindings=await db<{from_phone:string;provider_account_sid:string;caller_id_sid:string|null;call_sid:string;conversation_id:string}[]>(`icash_call_recordings?account_id=eq.${eq(accountId)}&operation_key=eq.${eq(b.operation_key)}&select=from_phone,provider_account_sid,caller_id_sid,call_sid,conversation_id`);
  const binding=bindings[0];
  if(bindings.length!==1||binding.from_phone!==call.from||binding.provider_account_sid!==r.twilioAccountSid||!sid(binding.caller_id_sid,'PN')||binding.call_sid!==call.sid||binding.conversation_id!==b.conversation_id)fail();
  r={...r,from:binding.from_phone};
 }
 if(call.sid!==j.provider_call_sid||call.account_sid!==r.twilioAccountSid||!phone(call.to)||(r.source.kind==='reviewed_destination_allowlist'&&call.to!==r.destination)||createHash('sha256').update(call.to).digest('hex')!==b.contact_key||call.from!==r.from||call.direction!=='outbound-api')fail();
 if(['queued','initiated','ringing','in-progress'].includes(call.status))unavailable();
 if(call.status!=='completed')fail();
 if(call.duration===null||call.duration===undefined||call.end_time===null||call.end_time===undefined)unavailable();
 if(typeof call.duration!=='string'||!/^\d+$/.test(call.duration)||!safe(Number(call.duration))||!Number.isFinite(Date.parse(call.end_time)))fail();
 const hash=createHash('sha256').update(JSON.stringify(r)).digest('hex');
 let voice=r.voice;let pricingRef='reviewed destination allowlist';
 if(r.source.kind==='twilio_pricing_api'){
  const source=r.source;
  const readSnapshot=()=>db<{snapshot:Record<string,unknown>}[]>(`icash_outbound_price_snapshots?operation_key=eq.${eq(b.operation_key)}&account_id=eq.${eq(accountId)}&select=snapshot`);
  let snapshots=await readSnapshot();
  if(!snapshots.length){
   const pricingLag=Date.now()-Date.parse(call.end_time);if(pricingLag<0||pricingLag>source.maxPricingLagSeconds*1000)fail();
   const url=`https://pricing.twilio.com/v2/Voice/Numbers/${eq(call.to)}?OriginationNumber=${eq(call.from)}`;
   const p=await get(url,{Authorization:'Basic '+Buffer.from(r.twilioAccountSid+':'+env.TWILIO_AUTH_TOKEN).toString('base64')});
   if(p.destination_number!==call.to||p.origination_number!==call.from||p.price_unit!=='USD'||!source.allowedCountries.includes(p.iso_country)||!Array.isArray(p.outbound_call_prices)||p.outbound_call_prices.length!==1)fail();
   const price=p.outbound_call_prices[0];
   if(price.current_price===null||price.current_price===undefined)unavailable();
   if(typeof price.current_price!=='string'||!/^\d+(?:\.\d{1,6})?$/.test(price.current_price)||!Array.isArray(price.origination_prefixes)||!price.origination_prefixes.length||!price.origination_prefixes.some((prefix:unknown)=>prefix==='ALL'||typeof prefix==='string'&&/^\+?\d+$/.test(prefix)&&call.from.replace(/^\+/, '').startsWith(prefix.replace(/^\+/, ''))))fail();
   const [whole,fraction='']=price.current_price.split('.');
   const rate=Number(BigInt(whole)*BigInt(1000000)+BigInt(fraction.padEnd(6,'0')));
   if(!safe(rate)||rate>source.maxMicrosPerMinute)fail();
   const fetchedAt=new Date().toISOString();
   const fetchedLag=Date.parse(fetchedAt)-Date.parse(call.end_time);
   if(fetchedLag<0||fetchedLag>source.maxPricingLagSeconds*1000)fail();
   await db('rpc/icash_record_outbound_price_snapshot','POST',{p_operation:b.operation_key,p_account:accountId,p_snapshot:{policyHash:hash,accountSid:r.twilioAccountSid,callSid:call.sid,conversationId:b.conversation_id,agentId:b.agent_id,destinationHash:b.contact_key,from:call.from,isoCountry:p.iso_country,unit:'USD',microsPerMinute:rate,fetchedAt,source:'twilio_pricing_api'}});
   snapshots=await readSnapshot();
  }
  if(snapshots.length!==1)fail();const p=snapshots[0].snapshot;
  if(p.policyHash!==hash||p.accountSid!==r.twilioAccountSid||p.callSid!==call.sid||p.conversationId!==b.conversation_id||p.agentId!==b.agent_id||p.destinationHash!==b.contact_key||p.from!==call.from||p.unit!=='USD'||p.source!=='twilio_pricing_api'||!source.allowedCountries.includes(String(p.isoCountry))||!safe(p.microsPerMinute)||Number(p.microsPerMinute)>source.maxMicrosPerMinute||!Number.isFinite(Date.parse(String(p.fetchedAt)))||Date.parse(String(p.fetchedAt))<Date.parse(call.end_time)||Date.parse(String(p.fetchedAt))-Date.parse(call.end_time)>source.maxPricingLagSeconds*1000)fail();
  voice={...r.voice,microsPerMinute:Number(p.microsPerMinute)};
  pricingRef=`immutable Twilio Pricing API snapshot:${b.operation_key}; country:${p.isoCountry}; fetched:${p.fetchedAt}`;
 }
 const duration=Number(call.duration);
 const amount=(p:{microsPerMinute:number;rounding:string;minimumMinutes:number})=>{
  const units=p.rounding==='up'?BigInt(Math.ceil(duration/60))*BigInt(60):BigInt(duration);
  const minimum=BigInt(p.minimumMinutes)*BigInt(60);return ((units>minimum?units:minimum)*BigInt(p.microsPerMinute)+BigInt(59))/BigInt(60);
 };
 const micros=Number(amount(voice)+amount(r.stream));if(!safe(micros))fail();
 // Carrier seconds are actual; voice/stream tariff cost remains an estimate. The
 // stream duration is explicitly a carrier proxy, not a claimed stream receipt.
 return {kind:'fixed_estimate',amountMicros:micros,evidenceRef:`Twilio canonical Call:${j.provider_call_sid}; actual carrier seconds:${duration}; destination snapshot:${r.snapshotId}; sha256:${hash}; ${pricingRef}; voice ${voice.microsPerMinute}/minute ${r.voice.rounding}; stream ${r.stream.microsPerMinute}/minute ${r.stream.rounding}; stream assumption:${r.stream.assumption}; ${r.evidenceRef}`};
}
