// Production-only credential provisioning. No calls, number purchases, or inbound route changes.
import {sealBrowserPhoneSecret,openBrowserPhoneSecret} from '../lib/browser-phone-credentials.ts';
export async function prepareBrowserCalling(env=process.env,fetcher=fetch){
 if(env.VERCEL_ENV!=='production')return {status:'not_requested'};
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!/^AC[\da-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID??'')||!env.TWILIO_AUTH_TOKEN)throw Error('BROWSER_PHONE_SETUP_REQUIRED');
 const dbHeaders={apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
 async function request(url,options={}){const r=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('BROWSER_PHONE_CONFIGURATION_UNCONFIRMED_'+r.status);return r.json();}
 const base=env.SUPABASE_URL+'/rest/v1/icash_browser_phone_config';
 const [existing]=await request(base+'?id=eq.1&select=*',{headers:dbHeaders});
 if(existing?.state==='ready'){
  if(existing.provider_account_sid!==env.TWILIO_ACCOUNT_SID||!openBrowserPhoneSecret(existing.secret_ciphertext,env.TWILIO_AUTH_TOKEN))throw Error('BROWSER_PHONE_CONFIG_MISMATCH');
  return {status:'ready'};
 }
 if(existing)throw Error('BROWSER_PHONE_PREVIOUS_SETUP_UNCONFIRMED');
 // A committed marker prevents duplicate keys if a deploy or provider response is interrupted.
 await request(base,{method:'POST',headers:dbHeaders,body:JSON.stringify({id:1,state:'preparing',provider_account_sid:env.TWILIO_ACCOUNT_SID})});
 const created=await request(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Keys.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({FriendlyName:'iCash X browser voice tokens'}).toString()});
 if(!/^SK[\da-f]{32}$/i.test(created.sid??'')||typeof created.secret!=='string'||created.secret.length<16)throw Error('BROWSER_PHONE_KEY_UNCONFIRMED');
 await request(base+'?id=eq.1&state=eq.preparing',{method:'PATCH',headers:dbHeaders,body:JSON.stringify({api_key_sid:created.sid,secret_ciphertext:sealBrowserPhoneSecret(created.secret,env.TWILIO_AUTH_TOKEN),state:'ready'})});
 return {status:'ready'};
}
if(process.argv[1]?.endsWith('/prepare-browser-calling.mjs'))prepareBrowserCalling().then(r=>console.log('Browser calling:',r.status)).catch(()=>{console.error('Browser calling configuration needs review; no calls were placed.');process.exitCode=1;});
