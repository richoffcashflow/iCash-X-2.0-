// Configuration booleans only. No model generation or SMS sends during a build.
const result={keyConfigured:!!process.env.OPENAI_API_KEY,status:process.env.OPENAI_API_KEY?'key_present_not_live_verified':'key_missing'};
if(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY)try{
 await fetch(`${process.env.SUPABASE_URL}/rest/v1/icash_integration_checks?on_conflict=provider`,{method:'POST',headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify({provider:'text_ai',checked_at:new Date().toISOString(),result}),signal:AbortSignal.timeout(10000)});
}catch{}
console.log(`SMS AI: ${result.status}. No model request or message sent.`);
