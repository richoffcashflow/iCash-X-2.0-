import {object,sid,uuid} from './required-call-recording.ts';

export type VoiceMeter = {
 accountId:string;operationKey:string;sessionKind:'outbound'|'inbound';sessionId:string;
 providerAccountSid:string;callSid:string|null;fromPhone:string;toPhone:string;
 direction:'outbound-api'|'inbound';maxSeconds:number;authorizedSeconds:number;
 confirmedSeconds:number;version:number;provisionalCents:number;state:string;
};
export type VoiceMeterRpc = <T=unknown>(name:string,body:Record<string,unknown>)=>Promise<T>;
export type VoiceMeterProvider = {
 getCall:(id:string)=>Promise<Record<string,unknown>>;
 limit:(id:string,seconds:number)=>Promise<Record<string,unknown>>;
 end:(id:string)=>Promise<Record<string,unknown>>;
};
export type MeterAdmission = {status:'disabled'}|{status:'held';reason?:string}|{status:'ready';meter:VoiceMeter};
const terminal=new Set(['completed','failed','busy','no-answer','canceled']);
const integer=(v:unknown,min:number,max:number)=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;

export function validVoiceMeter(value:unknown):value is VoiceMeter{
 const m=object(value);
 return uuid(m.accountId)&&uuid(m.sessionId)&&typeof m.operationKey==='string'&&m.operationKey.length<=160&&
  ['outbound','inbound'].includes(String(m.sessionKind))&&sid(m.providerAccountSid,'AC')&&
  (m.callSid===null||sid(m.callSid,'CA'))&&typeof m.fromPhone==='string'&&typeof m.toPhone==='string'&&
  m.direction===(m.sessionKind==='outbound'?'outbound-api':'inbound')&&integer(m.maxSeconds,120,600)&&
  integer(m.authorizedSeconds,60,Number(m.maxSeconds))&&integer(m.confirmedSeconds,0,Number(m.authorizedSeconds))&&
  integer(m.version,0,Number.MAX_SAFE_INTEGER)&&integer(m.provisionalCents,0,Number.MAX_SAFE_INTEGER)&&typeof m.state==='string';
}
export function meterCallMatches(m:VoiceMeter,call:Record<string,unknown>){
 return sid(call.sid,'CA')&&(!m.callSid||m.callSid===call.sid)&&call.account_sid===m.providerAccountSid&&
  call.from===m.fromPhone&&call.to===m.toPhone&&call.direction===m.direction;
}

/** Application usage estimates are provisional. Only the existing complete
 * provider-receipt settlement determines the final customer price.
 * No balance, elapsed time, prices or arbitrary provider URLs come from callers.
 */
export function createVoiceMetering(rpc:VoiceMeterRpc,provider:VoiceMeterProvider){
 async function advance(operation:string,call:Record<string,unknown>){
  return object(await rpc('icash_advance_voice_meter',{p_operation:operation,p_call:call}));
 }
 async function confirm(m:VoiceMeter,seconds:number,call:Record<string,unknown>){
  if(!meterCallMatches(m,call)||!integer(seconds,60,m.authorizedSeconds))throw Error('VOICE_METER_BINDING_REQUIRED');
  // Twilio acknowledges TimeLimit in the successful update command, but its
  // Call resource does not echo a time_limit field. Never invent that field.
  return await rpc('icash_confirm_voice_meter_limit',{p_operation:m.operationKey,p_version:m.version,p_seconds:seconds,p_call:call})===true;
 }
 async function stop(m:VoiceMeter){
  if(!m.callSid)throw Error('VOICE_METER_CALL_BINDING_REQUIRED');
  const ended=await provider.end(m.callSid);
  if(!meterCallMatches(m,ended)||!terminal.has(String(ended.status)))throw Error('VOICE_METER_TERMINATION_UNCONFIRMED');
  // A terminal HTTP response without final timing does not release commitments.
  // A later canonical receipt completes the durable accounting transition.
  const result=await advance(m.operationKey,ended);
  return {allowed:false as const,status:result.status==='ready'?'stopped':'termination_evidence_pending'};
 }
 return {
  async prepare(accountId:string,operationKey:string,sessionKind:'outbound'|'inbound',sessionId:string):Promise<MeterAdmission>{
   if(!uuid(accountId)||!uuid(sessionId)||!['outbound','inbound'].includes(sessionKind))throw Error('VOICE_METER_SESSION_REQUIRED');
   const a=object(await rpc('icash_prepare_voice_meter',{p_account:accountId,p_operation:operationKey,p_session_kind:sessionKind,p_session:sessionId}));
   if(a.status==='disabled')return {status:'disabled'};
   if(a.status==='held')return {status:'held',reason:typeof a.reason==='string'?a.reason:undefined};
   if(a.status!=='ready'||!validVoiceMeter(a.meter))throw Error('VOICE_METER_ADMISSION_UNCONFIRMED');
   const m=a.meter;
   if(m.accountId!==accountId||m.operationKey!==operationKey||m.sessionId!==sessionId||m.sessionKind!==sessionKind)throw Error('VOICE_METER_SESSION_MISMATCH');
   return {status:'ready',meter:m};
  },
  async cancelUnstarted(accountId:string,operationKey:string,sessionId:string){
   if(!uuid(accountId)||!uuid(sessionId))throw Error('VOICE_METER_SESSION_REQUIRED');
   // SQL proves a new outbound call was never claimed or sent. This is not a
   // timeout-based release and must never cancel an unknown provider outcome.
   const result=object(await rpc('icash_cancel_unstarted_voice_meter',{p_account:accountId,p_operation:operationKey,p_session:sessionId}));
   return result.status==='cancelled'&&result.cancelled===true;
  },
  confirm,
  async enforce(operationKey:string,call:Record<string,unknown>){
   const result=await advance(operationKey,call);
   if(result.status==='disabled')return {allowed:true as const,status:'legacy'};
   if(result.status!=='ready'||!validVoiceMeter(result.meter)||result.meter.operationKey!==operationKey)throw Error('VOICE_METER_ACCOUNTING_HELD');
   const m=result.meter;
   if(!meterCallMatches(m,call))throw Error('VOICE_METER_CALL_BINDING_REQUIRED');
   if(terminal.has(String(call.status)))return {allowed:false as const,status:'terminal'};
   if(result.terminate===true)return stop(m);
   // A signed callback or GET may race a dial acknowledgement. Neither proves
   // the funded carrier cap was installed, so do not connect AI yet.
   if(m.confirmedSeconds===0)return {allowed:false as const,status:'initial_cap_unconfirmed'};
   if(result.desiredTimeLimit!==undefined){
    const seconds=result.desiredTimeLimit;
    if(!integer(seconds,60,m.maxSeconds)||Number(seconds)>m.authorizedSeconds)throw Error('VOICE_METER_UNFUNDED_LIMIT');
    // SQL protects the entire new interval BEFORE this write. Any unknown
    // outcome retains it. Never replay an uncertain write using a stale token.
    try{
     const updated=await provider.limit(String(call.sid),Number(seconds));
     if(!await confirm(m,Number(seconds),updated))throw Error('VOICE_METER_LIMIT_SAVE_UNCONFIRMED');
     if(terminal.has(String(updated.status)))return {allowed:false as const,status:'terminal'};
    }catch{
     // A best-effort stop cannot undo an uncertain extension. The provider cap
     // remains funded even if both the update and termination response are lost.
     await stop({...m,callSid:String(call.sid)}).catch(()=>undefined);
     throw Error('VOICE_METER_LIMIT_UNCONFIRMED');
    }
   }
   return {allowed:true as const,status:'funded'};
  },
 };
}
export type VoiceMetering=ReturnType<typeof createVoiceMetering>;

/** One-use DB capability, claimed independently from normal automation. The
 * endpoint cannot start calls or select an account from request data. */
export const validVoiceMeterToken=(token:string)=>/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){2}$/.test(token);
export async function processVoiceMeterTicket(token:string,rpc:VoiceMeterRpc,provider:VoiceMeterProvider){
 if(!validVoiceMeterToken(token))return {status:'unauthorized',httpStatus:401};
 const ticket=object(await rpc('icash_consume_voice_metering',{p_token:token}));
 if(!validVoiceMeter(ticket.meter)||!ticket.meter.callSid)return {status:'expired_or_consumed',httpStatus:401};
 const m=ticket.meter,call=await provider.getCall(m.callSid!);
 if(!meterCallMatches(m,call))throw Error('VOICE_METER_PROVIDER_IDENTITY_MISMATCH');
 const result=await createVoiceMetering(rpc,provider).enforce(m.operationKey,call);
 return {status:result.status,httpStatus:200};
}
