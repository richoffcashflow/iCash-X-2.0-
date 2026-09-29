import {readFile} from 'node:fs/promises';
const key=process.env.DOCUSEAL_TEST_API_KEY;
async function db(path,method='GET',body){
 const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error('DATABASE_FAILED');const text=await r.text();return text?JSON.parse(text):null;
}
if(key&&process.env.SUPABASE_SECRET_KEY&&process.env.SUPABASE_URL){
 for(const kind of ['purchase','assignment']){
  const payload=JSON.parse(await readFile(new URL(`../config/signing-templates/${kind}.json`,import.meta.url),'utf8'));
  try{
   if(!await db('rpc/icash_claim_template_draft','POST',{p_key:payload.external_id}))continue;
   const r=await fetch('https://api.docuseal.com/templates/html',{method:'POST',headers:{'X-Auth-Token':key,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(45000)});
   if(!r.ok){await db(`icash_template_drafts?key=eq.${payload.external_id}`,'PATCH',{state:'needs_review',result:{status:`provider_http_${r.status}`}});continue;}
   const d=await r.json();if(!Number.isSafeInteger(d.id)||!Array.isArray(d.fields)||!Array.isArray(d.submitters))throw new Error('UNEXPECTED_RESPONSE');
   await db(`icash_template_drafts?key=eq.${payload.external_id}`,'PATCH',{state:'created',result:{id:d.id,name:d.name,roles:d.submitters.map(s=>({name:s.name,uuid:s.uuid})),fields:d.fields.map(f=>({name:f.name,type:f.type,required:f.required,readonly:f.readonly,submitter_uuid:f.submitter_uuid,areas:f.areas})),documents:d.documents,external_id:payload.external_id},updated_at:new Date().toISOString()});
   console.log(`${kind} test template created; live use remains disabled.`);
  }catch{console.log(`${kind} draft setup needs review. No automatic repeat.`);}
 }
}
