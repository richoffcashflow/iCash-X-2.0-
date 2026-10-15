const INTERVAL_MS=10000;
const ATTEMPT_TIMEOUT_MS=8000;
const STALE_AFTER_MS=30000;
const MAX_TICKETS_PER_PASS=20;
const MAX_CONCURRENT_REQUESTS=4;
const ENDPOINT='https://www.geticashx.com/api/internal/voice/metering';
const TOKEN_PATTERN=/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){2}$/;

/**
 * The DB owns due times, leases and one-use capabilities. Claiming returns only
 * null (including disabled policy) or {token}; no destination/provider secret is
 * accepted. A failed/ambiguous request is never retried with the same ticket.
 * rpc(name,args,{signal}) must honor the shared attempt deadline.
 */
async function claimVoiceMetering(rpc,signal){
 signal.throwIfAborted();
 const ticket=await rpc('icash_next_voice_metering',{},{signal});
 signal.throwIfAborted();
 if(ticket===null)return null;
 if(typeof ticket!=='object'||Array.isArray(ticket)||Object.keys(ticket).length!==1||
    typeof ticket.token!=='string'||ticket.token.length!==72||!TOKEN_PATTERN.test(ticket.token))throw Error('INVALID_VOICE_METERING_TICKET');
 return ticket;
}
async function dispatchVoiceMetering(ticket,transport,signal){
 signal.throwIfAborted();
 const response=await transport(ENDPOINT,{method:'POST',headers:{Authorization:'Bearer '+ticket.token},redirect:'error',signal});
 signal.throwIfAborted();
 if(!response.ok)throw Error('VOICE_METERING_HELD');
 return true;
}
export async function voiceMeteringTick(rpc,transport=fetch,{signal=AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)}={}){
 const ticket=await claimVoiceMetering(rpc,signal);
 return ticket===null?false:dispatchVoiceMetering(ticket,transport,signal);
}

/** Drain a bounded batch, not one global call per interval. Claims are serial;
 * up to four endpoints run concurrently under the SAME eight-second deadline.
 * Stop claiming on empty/failure and await all started requests before returning,
 * including on timeout. Expired/abandoned leases must mint fresh DB tickets.
 */
export async function voiceMeteringPass(rpc,transport=fetch,{signal=AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)}={}){
 const pending=new Set();
 let claimed=0,processed=0,empty=false,failed=false;
 try{
  while(claimed<MAX_TICKETS_PER_PASS&&!failed){
   signal.throwIfAborted();
   if(pending.size>=MAX_CONCURRENT_REQUESTS)await Promise.race(pending);
   if(failed)break;
   signal.throwIfAborted();
   const ticket=await claimVoiceMetering(rpc,signal);
   if(ticket===null){empty=true;break;}
   claimed++;
   // Another endpoint may fail while this claim is in flight. Do not dispatch
   // the newly claimed ticket in that case; the DB will reclaim its lease.
   if(failed)break;
   const request=dispatchVoiceMetering(ticket,transport,signal)
    .then(()=>{processed++;},()=>{failed=true;})
    .finally(()=>pending.delete(request));
   pending.add(request);
  }
 }catch{failed=true;}
 await Promise.all(pending);
 signal.throwIfAborted();
 if(failed)throw Error('VOICE_METERING_PASS_HELD');
 // A full batch is not evidence that every due call was serviced. Hold health
 // conservatively until a later pass observes an empty queue.
 if(!empty&&claimed===MAX_TICKETS_PER_PASS)throw Error('VOICE_METERING_CAPACITY_REACHED');
 return processed>0;
}

/** Independent short-deadline lane; never join the 55-second automation loop. */
export function createVoiceMeteringScheduler({rpc,transport=fetch,now=Date.now,onFailure=()=>{},timeoutSignal=ms=>AbortSignal.timeout(ms)}){
 let running=false,failures=0,completed=false,nextAt=0,lastCompletedAt=now();
 return {
  health(active=true){
   const stalled=now()-lastCompletedAt>STALE_AFTER_MS;
   return {code:active&&(stalled||failures>=3)?503:200,
    body:{voiceMetering:!active?'standby':stalled||failures?'held':completed?'available':'starting'}};
  },
  async run(){
   if(running)throw Error('VOICE_METERING_LOOP_ALREADY_RUNNING');
   if(now()<nextAt)return nextAt-now();
   running=true;
   nextAt=now()+INTERVAL_MS;
   try{
    await voiceMeteringPass(rpc,transport,{signal:timeoutSignal(ATTEMPT_TIMEOUT_MS)});
    failures=0;completed=true;
   }catch{
    failures=Math.min(failures+1,3);
    // Deliberately omit errors, tickets, provider data and credentials from logs.
    onFailure();
   }finally{
    running=false;lastCompletedAt=now();
   }
   return Math.max(0,nextAt-now());
  },
 };
}

/** Keep existing worker/automation fields while exposing this lane separately. */
export function withVoiceMeteringHealth(worker,metering){
 const meteringHeld=['held','starting'].includes(metering.body.voiceMetering);
 return {code:Math.max(worker.code,metering.code),body:{...worker.body,...metering.body,
  status:worker.body.status!=='standby'&&meteringHeld?'degraded':worker.body.status}};
}
