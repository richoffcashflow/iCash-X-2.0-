import {canSaveSharedIntegrationCheck} from './integration-check-write-policy.mjs';
// Read-only provider checks. Never send a document or create/change a template during builds.
for(const mode of ['test','live']){
 const key=process.env[mode==='live'?'DOCUSEAL_API_KEY':'DOCUSEAL_TEST_API_KEY'];
 const result={keyConfigured:!!key,liveKeyConfigured:!!process.env.DOCUSEAL_API_KEY,mode,connected:false,status:'missing_key',templates:[]};
 if(key)try{
  const r=await fetch('https://api.docuseal.com/templates?limit=10',{headers:{'X-Auth-Token':key},redirect:'error',signal:AbortSignal.timeout(10000)});
  result.status=r.ok?'connected':`provider_http_${r.status}`;
  if(r.ok){const body=await r.json();const rows=Array.isArray(body)?body:body.data;if(Array.isArray(rows)){result.connected=true;result.templates=rows.slice(0,10).map(t=>({id:t.id,name:typeof t.name==='string'?t.name.slice(0,200):null,roles:Array.isArray(t.submitters)?t.submitters.map(s=>({name:s.name,uuid:s.uuid})):[],fields:Array.isArray(t.fields)?t.fields.map(f=>({name:f.name,type:f.type,submitter_uuid:f.submitter_uuid})):[]}));}else result.status='unexpected_template_response';}
 }catch{result.status='connection_failed';}
 if(canSaveSharedIntegrationCheck()&&process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY)try{
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/icash_integration_checks?on_conflict=provider`,{method:'POST',headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify({provider:`docuseal_${mode}`,checked_at:new Date().toISOString(),result}),signal:AbortSignal.timeout(10000)});
 }catch{/* Diagnostics do not alter production gates. */}
 console.log(`DocuSeal ${mode}: ${result.status}. No document sent.`);
}
