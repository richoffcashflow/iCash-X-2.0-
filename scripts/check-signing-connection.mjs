// Read-only provider check. Runs server-side at build, never returns credentials or contacts.
const result={keyConfigured:!!process.env.DOCUSEAL_TEST_API_KEY,liveKeyConfigured:!!process.env.DOCUSEAL_API_KEY,mode:process.env.DOCUSEAL_MODE==='live'?'live':'test',connected:false,status:'missing_test_key',templates:[]};
if(result.keyConfigured){
 try{
  const r=await fetch('https://api.docuseal.com/templates?limit=10',{headers:{'X-Auth-Token':process.env.DOCUSEAL_TEST_API_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});
  result.status=r.ok?'connected':`provider_http_${r.status}`;
  if(r.ok){
   const body=await r.json();const rows=Array.isArray(body)?body:body.data;
   if(!Array.isArray(rows))result.status='unexpected_template_response';
   else{result.connected=true;result.templates=rows.slice(0,10).map(t=>({id:t.id,name:typeof t.name==='string'?t.name.slice(0,200):null,roles:Array.isArray(t.submitters)?t.submitters.map(s=>({name:s.name,uuid:s.uuid})):[],fields:Array.isArray(t.fields)?t.fields.map(f=>({name:f.name,type:f.type,submitter_uuid:f.submitter_uuid})):[]}));}
  }
 }catch{result.status='connection_failed';}
}
if(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY){
 try{
  const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/icash_integration_checks?on_conflict=provider`,{method:'POST',headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify({provider:'docuseal_test',checked_at:new Date().toISOString(),result}),signal:AbortSignal.timeout(15000)});
  console.log(r.ok?'Signing connection check saved privately.':'Signing connection check could not be saved.');
 }catch{console.log('Signing connection check could not be saved.');}
}
