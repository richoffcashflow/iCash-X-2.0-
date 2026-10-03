import {usdMicros} from './voice-usage-service.ts';
import {audioAvailable,object,sid,type RecordingRow} from './required-call-recording.ts';
import type {RecordingDb} from './required-call-recording-service.ts';
type CostItem={label:string;basis:'observed'|'estimated'|'not_applicable'|'pending';amountMicros:number|null};
const eq=encodeURIComponent;
export {recordingAddonCosts} from './required-call-recording-cost.ts';
import {recordingAddonCosts} from './required-call-recording-cost.ts';
export async function recordingPresentation(db:RecordingDb,accountId:string,conversationId:string,now=Date.now()){
 const calls=await db<{conversation_id:string;operation_key:string}[]>(`icash_live_conversations?id=eq.${eq(conversationId)}&account_id=eq.${eq(accountId)}&select=conversation_id,operation_key`);
 if(calls.length!==1)return null;
 const rows=await db<RecordingRow[]>(`icash_call_recordings?account_id=eq.${eq(accountId)}&operation_key=eq.${eq(calls[0].operation_key)}&conversation_id=eq.${eq(calls[0].conversation_id)}&select=*`);
 if(rows.length===0)return {status:'not_recorded'};if(rows.length!==1)return null;const row=rows[0];
 const [spend]=await db<{state:string;charged_cents:number|null;cost_basis:string|null}[]>(`icash_operation_spend?operation_key=eq.${eq(row.operation_key)}&account_id=eq.${eq(accountId)}&select=state,charged_cents,cost_basis`);
 const observations=await db<{provider:string;amount:unknown;units:string}[]>(`icash_cost_observations?event_key=eq.${eq(calls[0].conversation_id)}&source_ref=eq.${eq(row.operation_key)}&select=provider,amount,units`);
 const items:CostItem[]=[];
 const el=observations.filter(o=>o.provider==='elevenlabs'&&typeof o.units==='string'&&o.units.toLowerCase()==='usd');
 let amount:number|null=null;try{if(el.length===1)amount=usdMicros(el[0].amount);}catch{/* Missing/null/invalid receipt stays unknown. */}
 items.push({label:'ElevenLabs AI and model',basis:amount!==null?'observed':'pending',amountMicros:amount});
 items.push({label:'Carrier and streaming',basis:'pending',amountMicros:null});
 items.push({label:'Spoken-consent recognition',basis:'estimated',amountMicros:row.call_sid?20000:null});
 if(row.duration_seconds!==null){const add=recordingAddonCosts(row);items.push({label:'Twilio audio recording',basis:add.recordingObserved?'observed':'estimated',amountMicros:add.recording},{label:'30-day audio storage allocation',basis:'estimated',amountMicros:add.storage});}
 else items.push({label:'Twilio audio recording',basis:'pending',amountMicros:null},{label:'30-day audio storage allocation',basis:'pending',amountMicros:null});
 const manifests=await db<{components:unknown}[]>(`icash_cost_manifests?operation_key=eq.${eq(row.operation_key)}&select=components`);
 if(manifests.length===1){const c=object(manifests[0].components),carrier=object(c.twilio);if(Number.isSafeInteger(carrier.amountMicros)&&Number(carrier.amountMicros)>=0)items[1]={label:'Carrier and streaming',basis:carrier.basis==='verified'?'observed':'estimated',amountMicros:Number(carrier.amountMicros)};}
 const expired=!!row.audio_expires_at&&Date.parse(row.audio_expires_at)<=now;
 const status=row.state==='deleted'?'deleted':row.state==='deletion_pending'?'deletion_pending':expired?'expired':row.state;
 return {id:row.id,status,durationSeconds:row.duration_seconds,audioExpiresAt:row.audio_expires_at,providerReceipt:sid(row.recording_sid,'RE')?{provider:'Twilio',recordingSid:row.recording_sid,startAt:row.provider_started_at,endAt:row.ended_at}:null,costs:{status:items.some(x=>x.basis==='pending')?'pending':items.some(x=>x.basis==='estimated')?'estimated':'verified',holdCents:row.charge_cap_cents,customerChargeCents:spend?.state==='settled'?spend.charged_cents:null,items}};
}
