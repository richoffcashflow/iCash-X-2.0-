// Explicit, one-use release task. Creates draft templates only; never submissions.
import {readFile} from 'node:fs/promises';
const key=process.env.DOCUSEAL_API_KEY;
async function db(path,method='GET',body){
 const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('DATABASE_FAILED');const text=await r.text();return text?JSON.parse(text):null;
}
if(key&&process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY){
 for(const kind of ['purchase','assignment']){
  const task=`icash-x-live-${kind}-review-draft-v1`;
  try{
   const payload=JSON.parse(await readFile(new URL(`../config/signing-templates/${kind}.json`,import.meta.url),'utf8'));
   payload.external_id=task;payload.name=`iCash X - ${kind==='purchase'?'Contract to Purchase':'Assignment of Contract'} - REVIEW DRAFT`;
   payload.folder_name='iCash X Pending Review';payload.shared_link=false;
   // Preserve the visible not-for-live-use markings until contract review is complete.
   const claim=await db(`icash_template_drafts?key=eq.${task}&state=eq.claimed`,'PATCH',{state:'needs_review',updated_at:new Date().toISOString()});
   if(!claim?.length)continue;
   const r=await fetch('https://api.docuseal.com/templates/html',{method:'POST',headers:{'X-Auth-Token':key,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(45000)});
   if(!r.ok){await db(`icash_template_drafts?key=eq.${task}`,'PATCH',{result:{status:`provider_http_${r.status}`}});continue;}
   const d=await r.json();
   if(!Number.isSafeInteger(d.id)||!Array.isArray(d.fields)||!Array.isArray(d.submitters))throw Error('UNEXPECTED_RESPONSE');
   const roles=kind==='purchase'?['Seller','Customer']:['Cash Buyer','Customer'];
   const valid=roles.every(name=>{const role=d.submitters.find(s=>s.name===name);return role&&['signature','checkbox'].every(type=>d.fields.some(f=>f.submitter_uuid===role.uuid&&f.type===type&&f.required));});
   await db(`icash_template_drafts?key=eq.${task}`,'PATCH',{state:valid?'created':'needs_review',result:{id:d.id,name:d.name,roles:d.submitters.map(s=>({name:s.name,uuid:s.uuid})),fields:d.fields.map(f=>({name:f.name,type:f.type,required:f.required,readonly:f.readonly,submitter_uuid:f.submitter_uuid,areas:f.areas})),documents:d.documents,external_id:task,fieldValidation:valid,productionEnabled:false},updated_at:new Date().toISOString()});
   console.log(`${kind}: live-account draft saved, required signing fields ${valid?'verified':'need review'}. No submission created.`);
  }catch{console.log(`${kind}: draft creation needs reconciliation. No automatic repeat.`);}
 }
}
