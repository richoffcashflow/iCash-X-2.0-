// Read-only leased-line check; no messages or number purchases.
const key=process.env.CONTIGUITY_API_KEY,from=process.env.CONTIGUITY_FROM;
const result={keyConfigured:!!key,senderConfigured:!!from,webhookConfigured:!!process.env.CONTIGUITY_WEBHOOK_SECRET,matchedActiveLine:false,channels:[],status:'missing_configuration'};
if(key&&from)try{
 const r=await fetch('https://api.contiguity.com/numbers/leased',{headers:{Authorization:`Token ${key}`},redirect:'error',signal:AbortSignal.timeout(10000)});
 result.status=`provider_http_${r.status}`;
 if(r.ok){const b=await r.json();const line=b?.data?.numbers?.find(n=>n?.number?.e164===from);result.matchedActiveLine=line?.lease_status==='active';result.channels=Array.isArray(line?.capabilities?.channels)?line.capabilities.channels.filter(c=>typeof c==='string').slice(0,10):[];result.status=result.matchedActiveLine?'active_sender_found':'configured_sender_not_active';}
}catch{result.status='check_failed';}
if(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY)try{
 await fetch(`${process.env.SUPABASE_URL}/rest/v1/icash_integration_checks?on_conflict=provider`,{method:'POST',headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify({provider:'contiguity_text',checked_at:new Date().toISOString(),result}),signal:AbortSignal.timeout(10000)});
}catch{}
console.log(`Contiguity text: ${result.status}. No message sent.`);
