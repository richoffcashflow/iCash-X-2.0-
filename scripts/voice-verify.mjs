import {writeFileSync} from 'node:fs';
const out=[];
async function check(name,url,headers,summarize){
 try{const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});out.push({provider:name,status:r.status,...(r.ok?summarize(await r.json()):{})});}catch{out.push({provider:name,status:'network_error'});}
}
if(process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='voice-verification'){
 if(process.env.ELEVENLABS_API_KEY){
 await check('elevenlabs_agents','https://api.elevenlabs.io/v1/convai/agents?page_size=10',{'xi-api-key':process.env.ELEVENLABS_API_KEY},d=>({agentCount:Array.isArray(d.agents)?d.agents.length:null,hasMore:d.has_more??null}));
 await check('elevenlabs_numbers','https://api.elevenlabs.io/v1/convai/phone-numbers',{'xi-api-key':process.env.ELEVENLABS_API_KEY},d=>({importedNumbers:Array.isArray(d)?d.length:null,assignedNumbers:Array.isArray(d)?d.filter(x=>x.assigned_agent).length:null}));
 }else out.push({provider:'elevenlabs',status:'missing_key'});
 const sid=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN;
 if(sid&&token&&/^AC[a-f0-9]{32}$/i.test(sid))await check('twilio','https://api.twilio.com/2010-04-01/Accounts/'+sid+'/IncomingPhoneNumbers.json?PageSize=10',{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64')},d=>({numberCount:Array.isArray(d.incoming_phone_numbers)?d.incoming_phone_numbers.length:null,voiceNumbers:d.incoming_phone_numbers?.filter(x=>x.capabilities?.voice).length??null}));
 else out.push({provider:'twilio',status:'missing_or_invalid_configuration'});
 out.push({webhookSecretConfigured:!!process.env.ELEVENLABS_WEBHOOK_SECRET});
 writeFileSync('public/voice-verification.json',JSON.stringify(out));
}