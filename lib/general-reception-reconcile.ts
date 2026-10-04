import {createHash,createHmac} from 'node:crypto';
import {twilioUsdChargeMicros} from './twilio-usd-cost.ts';
import {readReviewedReceptionSettlement,settleReviewedReception} from './general-reception-settlement.ts';
import {boundedBody,receptionReceiptProfile,receptionCompletionArgs,receptionTarget,type ReceptionEnv,type ReceptionDeps} from './general-reception.ts';
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const hold=(reason:string)=>({status:'held',reason,message:'Call verification needs review ('+reason.replaceAll('_',' ')+'). This check has not confirmed the current settlement status.',settled:null,providerMarginVerified:false});
// Normalize the provider's known USD numeric field to ledger precision using
// decimal half-up rounding, not binary floating-point multiplication. A numeric
// JSON value can legitimately serialize with 18 fractional digits or exponent
// notation. This is currency precision normalization, never a credits conversion.
export function receptionUsdNumberMicros(value:unknown):number|null {
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)return null;
 const match=/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value));if(!match)return null;
 const fraction=match[2]??'',coefficient=BigInt(match[1]+fraction),scale=Number(match[3]??0)-fraction.length+6;
 let rounded:bigint;
 if(scale>=0)rounded=coefficient*BigInt(10)**BigInt(scale);
 else {const divisor=BigInt(10)**BigInt(-scale);rounded=(coefficient+divisor/BigInt(2))/divisor;}
 return rounded<=BigInt(Number.MAX_SAFE_INTEGER)?Number(rounded):null;
}
// Only called after both canonical GET receipts pass the exact call binding.
// Twilio strings remain exact; known ElevenLabs USD numbers are rounded to micros.
// Unknown units, null prices and provider credit units remain held.
function knownProviderCosts(call:Record<string,unknown>,conversation:Record<string,unknown>){
 const metadata=obj(conversation.metadata),price=call.price,fiat=metadata.cost_fiat;
 const shape=(v:unknown)=>v===undefined?'missing':v===null?'null':Array.isArray(v)?'array':typeof v;
 const decimalShape=(v:unknown)=>{const s=typeof v==='string'?v:typeof v==='number'?String(v):'';return {notation:/^-?\d+(?:\.\d+)?$/.test(s)?'decimal':/^-?\d+(?:\.\d+)?e[+-]?\d+$/i.test(s)?'exponent':'unrecognized',fractionDigits:/^-?\d+\.(\d+)$/.exec(s)?.[1].length??null};};
 const costShape={twilioPriceType:shape(price),twilioPriceUnitType:shape(call.price_unit),twilioUnit:call.price_unit==='USD'?'USD':call.price_unit==='usd'?'usd':call.price_unit==null?'absent':'other',twilioPriceSign:typeof price==='string'&&price.startsWith('-')?'negative':typeof price==='string'&&/^0(?:\.0+)?$/.test(price)?'zero':'other',twilioPriceNotation:decimalShape(price).notation,twilioPriceFractionDigits:decimalShape(price).fractionDigits,elevenMetadataType:shape(conversation.metadata),elevenCostFiatType:shape(fiat),elevenCostFiatNotation:decimalShape(fiat).notation,elevenCostFiatFractionDigits:decimalShape(fiat).fractionDigits,elevenCreditCostType:shape(metadata.cost),elevenRootCostFiatType:shape(conversation.cost_fiat)};
 const twilioUsdMicros=call.status==='completed'?twilioUsdChargeMicros(price,call.price_unit):null;
 const elevenLabsUsdMicros=conversation.status==='done'?receptionUsdNumberMicros(fiat):null;
 const sum=twilioUsdMicros!==null&&elevenLabsUsdMicros!==null?twilioUsdMicros+elevenLabsUsdMicros:null;
 return {currency:'USD',elevenLabsUsdRounding:'decimal_half_up_to_micros',costShape,twilioUsdMicros,elevenLabsUsdMicros,providerSubtotalUsdMicros:sum!==null&&Number.isSafeInteger(sum)?sum:null,
  twilioReceiptHash:createHash('sha256').update(JSON.stringify(call)).digest('hex'),elevenLabsReceiptHash:createHash('sha256').update(JSON.stringify(conversation)).digest('hex'),
  allInCostVerified:false,scope:'twilio_call_connectivity_and_elevenlabs_conversation_only'};
}
/** Called only by the fixed authenticated owner control, never by caller requests.
 * No new webhook secret is needed: both receipts are obtained over authenticated
 * fixed-origin provider APIs using existing server credentials. No provider writes. */
export async function reconcileReception(env:ReceptionEnv,deps:ReceptionDeps){
 try{
  if(typeof window!=='undefined')return hold('provider_configuration_missing');
  const signal=AbortSignal.timeout(20000),fetcher=deps.fetcher??fetch;
  const r=obj(await deps.rpc('icash_latest_general_reception_receipt',{},signal));
  if(!Object.keys(r).length)return {status:'no_call',settled:false,message:'No admitted reception call has been recorded yet.'};
  const profile=receptionReceiptProfile(r);
  if(!profile||r.account_id!==receptionTarget.accountId||r.agent_id!==receptionTarget.agentId||typeof r.call_sid!=='string'||!/^CA[0-9a-fA-F]{32}$/.test(r.call_sid)||typeof r.receipt_nonce!=='string'||!/^[a-f0-9]{64}$/.test(r.receipt_nonce)||r.operation_key!=='reception:'+r.call_sid)return hold('receipt_binding_invalid');
  const previous=await readReviewedReceptionSettlement(r,deps,signal);
  if(previous)return {status:r.state==='failed'?'failed':'completed',customerChargeCapCents:profile.customerChargeCapCents,...previous,message:'The previously reviewed call settlement is confirmed in the ledger. No additional charge was made.'};
  if(!/^AC[0-9a-fA-F]{32}$/.test(env.TWILIO_ACCOUNT_SID??'')||!env.TWILIO_AUTH_TOKEN||!env.ELEVENLABS_API_KEY)return hold('provider_configuration_missing');
  const read=async(url:string,headers:Record<string,string>)=>{
   const response=await fetcher(url,{headers,redirect:'error',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(6000)])});
   if(!response.ok||response.url&&response.url!==url)throw Error('PROVIDER_UNAVAILABLE');
   return obj(JSON.parse(await boundedBody(response,512*1024)));
  };
  const origin='https://api.us.elevenlabs.io',headers={'xi-api-key':env.ELEVENLABS_API_KEY};
  const userId='icash-reception:'+r.receipt_nonce;
  const list=await read(origin+'/v1/convai/conversations?'+new URLSearchParams({agent_id:receptionTarget.agentId,user_id:userId,page_size:'2'}),headers);
  if(list.has_more!==false||!Array.isArray(list.conversations)||list.conversations.length!==1)return hold('conversation_not_uniquely_available');
  const conversationId=obj(list.conversations[0]).conversation_id;
  if(typeof conversationId!=='string'||!/^conv_[A-Za-z0-9]{1,100}$/.test(conversationId))return hold('conversation_binding_invalid');
  const [data,call]=await Promise.all([
   read(origin+'/v1/convai/conversations/'+conversationId,headers),
   read(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${r.call_sid}.json`,{Authorization:'Basic '+Buffer.from(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN).toString('base64')}),
  ]);
  const init=obj(data.conversation_initiation_client_data),vars=obj(init.dynamic_variables),created=Date.parse(String(call.date_created)),reserved=Date.parse(String(r.reserved_at));
  if(data.conversation_id!==conversationId||data.agent_id!==r.agent_id||data.branch_id!==r.branch_id||data.version_id!==r.reviewed_version_id||vars.icash_reception_receipt_nonce!==r.receipt_nonce||vars.icash_reception_call_sid!==r.call_sid||(data.user_id??init.user_id)!==userId)return hold('conversation_binding_invalid');
  if(call.sid!==r.call_sid||call.account_sid!==env.TWILIO_ACCOUNT_SID||call.to!==receptionTarget.calledNumber||call.direction!=='inbound'||typeof call.from!=='string'||createHmac('sha256',env.TWILIO_AUTH_TOKEN).update('reception-caller-v1\0'+call.from).digest('hex')!==r.caller_hash||!Number.isFinite(created)||!Number.isFinite(reserved)||created>reserved||reserved-created>120000)return hold('carrier_binding_invalid');
  if(!['completed','failed','busy','no-answer','canceled'].includes(String(call.status))||!['done','failed'].includes(String(data.status)))return hold('call_not_terminal');
  const duration=obj(data.metadata).call_duration_secs;
  if(typeof duration!=='number'||!Number.isFinite(duration)||duration<0||duration>profile.maxDurationSeconds+2)return hold('duration_requires_review');
  const args=receptionCompletionArgs(data);if(!args)return hold('completion_binding_invalid');
  const finished=await deps.rpc('icash_finish_general_reception',args,signal);
  if(!finished)return hold('ledger_binding_conflict');
  const costEvidence=knownProviderCosts(call,data);
  const settlement=await settleReviewedReception(r,conversationId,duration,costEvidence,deps,signal);
  return {status:data.status==='done'?'completed':'failed',durationSeconds:duration,customerChargeCapCents:profile.customerChargeCapCents,costEvidence,providerMarginVerified:false,...settlement,
   message:settlement.settled?'Call completion and reviewed cost settlement verified. The unused reservation has been released.':settlement.settlementReason==='settlement_status_unconfirmed'?'Call completion verified. Settlement status is unconfirmed; retry the same receipt check before taking any financial action.':'Call completion verified from both providers. This check did not settle the call; complete matching cost evidence is required. No charge above the reservation is authorized.'};
 }catch{return hold('provider_receipt_unavailable');}
}
