// Owner reported non-receipt. Read the exact provider records; never send,
// recreate an agreement, print signing URLs, or expose provider credentials.
import {boundedBytes} from '../lib/required-call-recording-provider.ts';
const provider='owner_contract_text_nonreceipt_20261009';
const account='48dfb798-8c1a-404f-88c0-c396cc067062';
const messageId='305e7910-84b5-47d5-aaed-aea96e04b322';
const envelopeId='1de3b5be-b70a-4b55-b994-2e95b4a446be';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main'||Date.now()>Date.parse('2026-10-09T04:00:00Z'))process.exit(0);
try{
 const env=process.env;
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!env.CONTIGUITY_API_KEY||!env.DOCUSEAL_API_KEY)throw Error('CONFIGURATION_REQUIRED');
 async function json(url,headers,method='GET',body){
  const r=await fetch(url,{method,headers:{...headers,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('HTTP_'+r.status);
  if(r.status===204||r.headers.get('content-length')==='0')return null;
  return JSON.parse((await boundedBytes(r,524288)).toString('utf8'));
 }
 const db=(path,method,body)=>json(env.SUPABASE_URL+'/rest/v1/'+path,{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,Prefer:'resolution=merge-duplicates'},method,body);
 const prior=await db('icash_integration_checks?provider=eq.'+provider+'&select=provider');
 if(prior.length){console.log('Contract text inspection: already saved.');process.exit(0);}
 const [m]=await db(`icash_text_messages?id=eq.${messageId}&account_id=eq.${account}&select=id,thread_id,provider_id,body,state`);
 const [e]=await db(`icash_signing_envelopes?id=eq.${envelopeId}&account_id=eq.${account}&select=id,provider_id,terms_hash,recipients,test_mode`);
 if(m?.provider_id!=='text_cbXOoIHXTxTkeRRg'||e?.provider_id!=='12082979'||e.test_mode)throw Error('BINDING_REQUIRED');
 const [t]=await db(`icash_text_threads?id=eq.${m.thread_id}&account_id=eq.${account}&select=sender,recipient`);
 if(t?.recipient!=='+12142185280'||t.sender!=='+14243948384')throw Error('RECIPIENT_CHANGED');
 const result={messageId,envelopeId,recipientLast4:t.recipient.slice(-4),carrierReceiptState:m.state,recipientReportedMissing:true};
 try{
  const raw=await json('https://api.contiguity.com/conversations/history/message/'+encodeURIComponent(m.provider_id),{Authorization:'Token '+env.CONTIGUITY_API_KEY});
  const p=raw.data??{};
  result.provider={id:p.id,status:p.status,timestamp:p.timestamp,idMatches:p.id===m.provider_id,fromMatches:p.from===t.sender,toMatches:p.to===t.recipient,bodyMatches:p.message===m.body,tracking:(Array.isArray(p.tracking)?p.tracking:[]).slice(-12).map(x=>({event:x.event,timestamp:x.timestamp,title:typeof x.title==='string'?x.title.slice(0,200):undefined}))};
 }catch(error){result.provider={error:error.message};}
 try{
  const p=await json('https://api.docuseal.com/submissions/'+e.provider_id,{'X-Auth-Token':env.DOCUSEAL_API_KEY});
  const s=p.submitters?.find(s=>s.external_id===`${e.id}:${e.recipients[0]?.id}`);
  result.signing={submissionMatches:String(p.id)===e.provider_id,order:p.submitters_order,status:p.status,completed:p.completed_at??null,recipientMatches:s?.phone===t.recipient,termsMatch:s?.metadata?.terms_hash===e.terms_hash,signerId:s?.id,signerStatus:s?.status,sentAt:s?.sent_at??null,openedAt:s?.opened_at??null,completedAt:s?.completed_at??null,smsPreference:s?.preferences?.send_sms};
 }catch(error){result.signing={error:error.message};}
 await db('icash_integration_checks?on_conflict=provider','POST',{provider,checked_at:new Date().toISOString(),result});
 console.log('Contract text inspection: saved. No message sent.');
}catch{console.log('Contract text inspection: unavailable. No message sent.');}
