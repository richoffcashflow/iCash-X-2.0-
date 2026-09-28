import {mkdir,writeFile} from 'node:fs/promises';
if(process.env.VERCEL_ENV==='preview'){
 const checks={keyPresent:!!process.env.ELEVENLABS_API_KEY,sellerCallingEnabled:false};
 for(const [name,path] of [['agents','/v1/convai/agents?page_size=1'],['voices','/v2/voices?page_size=1']]){
  try{const r=await fetch('https://api.elevenlabs.io'+path,{headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY||''},signal:AbortSignal.timeout(15000),redirect:'error'});checks[name+'Status']=r.status;}
  catch{checks[name+'Status']='unreachable';}
 }
 await mkdir('public',{recursive:true});await writeFile('public/voice-preflight.json',JSON.stringify(checks));
 console.log('ElevenLabs read-only check',JSON.stringify(checks));
}