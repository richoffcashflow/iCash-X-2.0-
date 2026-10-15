// Read existing contact data through PostgREST. Never start calls, send messages,
// create consent, or log customer data/credentials. Exercise actual API transactions.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function checkContactRpcs({env=process.env,fetcher=fetch}={}){
 if(env.VERCEL_ENV!=='production')return {status:'not_requested'};
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)throw Error('Contact API verification needs database configuration.');
 const headers={apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
 async function read(path,body){
  const response=await fetcher(env.SUPABASE_URL+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Contact API verification failed: '+path.split('?')[0]+' HTTP '+response.status);
  const payload=await response.text();
  return payload?JSON.parse(payload):null;
 }
 const screens=await read('icash_screening_jobs?'+new URLSearchParams({state:'eq.complete','snapshot->sellerRequest->>id':'not.is.null',select:'id,account_id',order:'created_at.desc',limit:'3'}));
 const checked=[];
 for(const screen of screens){
  const params={p_account:screen.account_id,p_screening:screen.id};
  const contacts=await read('rpc/icash_manual_contacts',params);
  if(!Array.isArray(contacts))throw Error('Contact API returned an invalid contact list.');
  if(!contacts.length)continue;
  const contact=contacts[0];
  const reason=await read('rpc/icash_manual_contact_reason',{...params,p_phone:contact.phone,p_channel:'voice'});
  const sender=await read('rpc/icash_customer_call_sender',{...params,p_recipient:contact.phone});
  if((reason!==null&&typeof reason!=='string')||(sender!==null&&typeof sender!=='string'))throw Error('Contact API returned an invalid call result.');
  const scope='account_id=eq.'+screen.account_id+'&screening_id=eq.'+screen.id;
  await read('icash_call_recordings?'+scope+'&call_sid=not.is.null&conversation_id=is.null&select=id,state,created_at,consent_at,last_error&order=created_at.desc&limit=3');
  await read('icash_customer_phone_calls?'+scope+'&select=id,state,connection_type,callback_phone,ended_at,recording_required,recording_state,recording_sid,recording_expires_at,recording_deleted_at&order=created_at.desc&limit=1');
  const deals=await read('icash_deal_files?'+scope+'&select=id&limit=1');
  if(deals[0]){
   const threads=await read('icash_text_threads?account_id=eq.'+screen.account_id+'&deal_id=eq.'+deals[0].id+'&retired_at=is.null&select=id,sender&limit=1');
   if(threads[0]){
    const textReason=await read('rpc/icash_manual_text_reason',{p_account:screen.account_id,p_thread:threads[0].id});
    if(textReason!==null&&typeof textReason!=='string')throw Error('Contact API returned an invalid text result.');
   }
  }
  checked.push(createHash('sha256').update(screen.id).digest('hex').slice(0,12));
 }
 return {status:checked.length?'passed':'no_active_contacts',checked};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 checkContactRpcs().then(result=>console.log('Contact API verification:',JSON.stringify(result))).catch(()=>{console.error('Contact API verification failed; no calls or messages were started.');process.exitCode=1;});
}
