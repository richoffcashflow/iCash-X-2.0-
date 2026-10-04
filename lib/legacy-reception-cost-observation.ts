import {createHash} from 'node:crypto';
import {boundedBody,receptionTarget} from './general-reception.ts';
import {ownerInboundTarget} from './owner-inbound-acceptance.ts';
import {receptionUsdNumberMicros} from './general-reception-reconcile.ts';
import {twilioUsdChargeMicros} from './twilio-usd-cost.ts';

// Fixed historical calls holding the owner's credits at launch. This collector
// reads receipts only; it cannot create a financial review, settle or release funds.
export const legacyReceptionTargets=Object.freeze([
 {receiptId:'81e119e5-e026-4a8d-9a34-9d5cc0154de9',callSid:'CAff886c99a6dce49e43a9d1f89c00c83a',conversationId:'conv_8701m3z2rhqce8gvz0sw73a11sfs'},
 {receiptId:'8bbf9c94-4af1-4ec7-9ea1-0b3aa746d917',callSid:'CAef453ff08282fa2c89c0a3aff46250db',conversationId:'conv_5401m3z84kzmeabrapakkye1xj9s'},
]);
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export async function observeLegacyReceptionCosts(env:Record<string,string|undefined>,fetcher:typeof fetch=fetch){
 return Promise.all(legacyReceptionTargets.map(async target=>{
  const unavailable={receiptId:target.receiptId,status:'unavailable'};
  if(!/^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID??'')||!env.TWILIO_AUTH_TOKEN||!env.ELEVENLABS_API_KEY)return unavailable;
  async function read(url:string,headers:Record<string,string>){
   const r=await fetcher(url,{method:'GET',headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
   if(!r.ok||r.redirected||r.url&&r.url!==url||!/^application\/json(?:;|$)/i.test(r.headers.get('content-type')??''))throw Error('UNAVAILABLE');
   return obj(JSON.parse(await boundedBody(r,512*1024)));
  }
  try{
   const [call,conversation]=await Promise.all([
    read(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${target.callSid}.json`,{Authorization:'Basic '+Buffer.from(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN).toString('base64')}),
    read('https://api.us.elevenlabs.io/v1/convai/conversations/'+target.conversationId,{'xi-api-key':env.ELEVENLABS_API_KEY}),
   ]);
   const init=obj(conversation.conversation_initiation_client_data),vars=obj(init.dynamic_variables),nonce=vars.icash_reception_receipt_nonce,metadata=obj(conversation.metadata);
   const duration=metadata.call_duration_secs,carrierSeconds=typeof call.duration==='string'&&/^\d{1,4}$/.test(call.duration)?Number(call.duration):null;
   if(call.sid!==target.callSid||call.account_sid!==env.TWILIO_ACCOUNT_SID||call.to!==receptionTarget.calledNumber||call.from!==ownerInboundTarget.ownerPhone||call.direction!=='inbound'||call.status!=='completed'||conversation.conversation_id!==target.conversationId||conversation.agent_id!==receptionTarget.agentId||conversation.status!=='done'||typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce)||vars.icash_reception_call_sid!==target.callSid||(conversation.user_id??init.user_id)!=='icash-reception:'+nonce||typeof conversation.branch_id!=='string'||!/^agtbrch_[A-Za-z0-9]+$/.test(conversation.branch_id)||typeof conversation.version_id!=='string'||!/^agtvrsn_[A-Za-z0-9]+$/.test(conversation.version_id)||typeof duration!=='number'||!Number.isFinite(duration)||duration<0||duration>62||carrierSeconds===null||carrierSeconds>120)return {...unavailable,status:'binding_needs_review'};
   const twilioMicros=twilioUsdChargeMicros(call.price,call.price_unit);
   const carrierCostShape={priceType:call.price===null?'null':typeof call.price,unit:call.price_unit==='USD'?'USD':call.price_unit==='usd'?'usd':call.price_unit==null?'missing':'other',exactUsdCharge:twilioMicros!==null};
   const elevenLabsMicros=receptionUsdNumberMicros(metadata.cost_fiat);
   return {receiptId:target.receiptId,status:twilioMicros!==null&&elevenLabsMicros!==null?'observed':'cost_unknown',callSid:target.callSid,conversationId:target.conversationId,branchId:conversation.branch_id,versionId:conversation.version_id,nonceHash:hash(nonce),durationSeconds:duration,carrierSeconds,
    twilioMicros,elevenLabsMicros,carrierCostShape,twilioReceiptHash:hash(JSON.stringify(call)),elevenLabsReceiptHash:hash(JSON.stringify(conversation)),scope:'provider_costs_only',settled:false};
  }catch{return unavailable;}
 }));
}
