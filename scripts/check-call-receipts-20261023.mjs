// Bounded production receipt inspection. GETs existing carrier records only;
// never dial, message, price a new call, settle money or change provider settings.
import {pathToFileURL} from 'node:url';
import {createRecordingProviders,boundedBytes} from '../lib/required-call-recording-provider.ts';
export async function checkCallReceipts(env=process.env,fetcher=fetch,now=Date.now()){
 if(env.VERCEL_ENV!=='production'||env.VERCEL_GIT_COMMIT_REF!=='main'||now>Date.parse('2026-10-25T00:00:00Z'))return {status:'not_requested'};
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)return {status:'configuration_unavailable'};
 const name='call_receipt_diagnostic_20261023';
 const db=async(path,body)=>{
  const r=await fetcher(env.SUPABASE_URL+'/rest/v1/'+path,{method:body?'POST':'GET',headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('RECEIPT_DIAGNOSTIC_UNAVAILABLE');
  return r.status===204?null:JSON.parse((await boundedBytes(r,262144)).toString('utf8'));
 };
 const prior=await db('icash_integration_checks?provider=eq.'+name+'&select=checked_at');
 if(prior.length)return {status:'already_checked'};
 const rows=await db('icash_customer_phone_calls?settled_at=is.null&parent_sid=not.is.null&order=created_at.asc&limit=3&select=id,parent_sid,provider_account_sid,business_phone,callback_phone,state');
 const p=createRecordingProviders(env,fetcher),calls=[];
 for(const row of rows){
  if(row.provider_account_sid!==env.TWILIO_ACCOUNT_SID)continue;
  const c=await p.getCall(row.parent_sid);
  if(c.sid!==row.parent_sid||c.account_sid!==row.provider_account_sid||c.from!==row.business_phone||c.to!==row.callback_phone||c.direction!=='outbound-api')continue;
  const scalar=v=>typeof v==='string'||typeof v==='number'?v:null;
  calls.push({callId:row.id,state:row.state,providerStatus:scalar(c.status),price:scalar(c.price),priceUnit:scalar(c.price_unit),durationSeconds:scalar(c.duration)});
 }
 await db('icash_integration_checks?on_conflict=provider',{provider:name,checked_at:new Date(now).toISOString(),result:{status:'checked',calls,readOnlyProvider:true}});
 return {status:'checked',count:calls.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log('Existing call receipts:',JSON.stringify(await checkCallReceipts()));}
 catch{console.log('Existing call receipts: inspection unavailable; financial holds unchanged.');}
}
