// One existing, terminal owner call only. Provider GETs; no dial or replay.
import {pathToFileURL} from 'node:url';
import {createRecordingProviders,boundedBytes} from '../lib/required-call-recording-provider.ts';
import {recordingHandoffDiagnostic} from '../lib/recording-handoff-diagnostic.ts';
const account='48dfb798-8c1a-404f-88c0-c396cc067062',id='c3314569-a134-4fa0-b0e7-a83ed83e0280',callSid='CA263fbbaa9e0c902454d37f345554c3e5';
export const ownerStartupDiagnosticKey='owner_call_startup_20261113_0316';
export async function inspectOwnerStartup(env=process.env,fetcher=fetch,now=Date.now()){
 if(env.VERCEL_ENV!=='production'||env.VERCEL_GIT_COMMIT_REF!=='main'||! /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA??'')||now>Date.parse('2026-11-15T00:00:00Z'))return 'skipped';
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)return 'unavailable';
 const db=async(path,body)=>{
  const r=await fetcher(env.SUPABASE_URL+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error('DIAGNOSTIC_STORE_UNAVAILABLE');
  return body===undefined?JSON.parse((await boundedBytes(r,65536)).toString('utf8')):null;
 };
 const prior=await db('icash_integration_checks?provider=eq.'+ownerStartupDiagnosticKey+'&select=provider');
 if(!Array.isArray(prior)||prior.length)return 'already_saved';
 const rows=await db('icash_call_recordings?id=eq.'+id+'&account_id=eq.'+account+'&select=id,account_id,call_sid,provider_account_sid,from_phone,to_phone,state,nonce_hash,start_claimed_at,recording_authorized_at,conversation_id');
 if(!Array.isArray(rows)||rows.length!==1)return 'binding_unavailable';
 const row=rows[0];
 if(row.id!==id||row.account_id!==account||row.call_sid!==callSid||row.state!=='failed'||!row.recording_authorized_at||row.start_claimed_at||row.conversation_id)return 'binding_unavailable';
 const api=createRecordingProviders(env,fetcher,AbortSignal.timeout(24000));
 const result=await recordingHandoffDiagnostic(row,{getCall:api.getCall,getCallEventsPage:api.getCallEventsPage,getCallNotifications:api.getCallNotifications},env,now);
 if(!['complete','incomplete_page'].includes(result.status))return result.status;
 await db('icash_integration_checks?on_conflict=provider',{provider:ownerStartupDiagnosticKey,checked_at:new Date(now).toISOString(),result:{...result,recordingId:id,commit:env.VERCEL_GIT_COMMIT_SHA,mode:'read_only',callsPlaced:0,messagesSent:0}});
 return 'saved';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log('Owner startup inspection: '+await inspectOwnerStartup()+'. No call placed.');}
 catch{console.log('Owner startup inspection: unavailable. No call placed.');}
}
