// Owner-requested replacement of the legacy opening voice. Fixed, public product
// copy only; no caller data, dialing, recording, agent changes, or credential output.
// Committed assets skip generation completely on every later deployment.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory='public/audio/reception-v4-20261007';
const texts={
 notice:"Hi, I'm the receptionist, the AI assistant for iCash X. We save a transcript and keep audio private for 30 days.",
 question:'Is it okay to record?',
 goodbye:"Okay, I won't record a conversation without your permission. Take care.",
};
const hash=x=>createHash('sha256').update(x).digest('hex');
async function bounded(response,max){
 if(!response.body)throw Error('EMPTY_RESPONSE');const chunks=[];let total=0;
 for await(const part of response.body){total+=part.length;if(total>max)throw Error('RESPONSE_TOO_LARGE');chunks.push(part);}return Buffer.concat(chunks);
}
try{
 let manifest;try{manifest=JSON.parse(await readFile(directory+'/manifest.json','utf8'));}catch{}
 if(manifest){
  if(manifest.model!=='eleven_v4')throw Error('PROMPT_MODEL_MISMATCH');
  for(const [name,text] of Object.entries(texts)){const audio=await readFile(directory+'/'+name+'.mp3');if(manifest.files[name]?.text!==text||manifest.files[name]?.sha256!==hash(audio))throw Error('PROMPT_ASSET_MISMATCH');}
  console.log('RECEPTION_PROMPTS_VERIFIED',JSON.stringify({model:manifest.model,files:3,generationRequests:0}));
 }else{
  if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main'||!process.env.ELEVENLABS_API_KEY)throw Error('TRUSTED_PRODUCTION_GENERATION_REQUIRED');
  const origin='https://api.us.elevenlabs.io',headers={'xi-api-key':process.env.ELEVENLABS_API_KEY};
  const agentId='agent_7801m3qsygdwfv5tggatf7w68y3d',branchId='agtbrch_9101m416pfheeb284rmpy0c91xak',versionId='agtvrsn_4701m416rcp0fzprqzkvkvg1v2ww';
  const response=await fetch(origin+'/v1/convai/agents/'+agentId+'?branch_id='+branchId,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('AGENT_READ_HTTP_'+response.status);
  const agent=JSON.parse((await bounded(response,262144)).toString());const tts=agent.conversation_config?.tts;
  if(agent.agent_id!==agentId||agent.branch_id!==branchId||agent.version_id!==versionId||agent.platform_settings?.auth?.enable_auth!==true||agent.conversation_config?.conversation?.max_duration_seconds!==600||!/^[A-Za-z0-9]{10,100}$/.test(tts?.voice_id??''))throw Error('REVIEWED_AGENT_REQUIRED');
  console.log('RECEPTION_CONVERSATION_VOICE',JSON.stringify({model:tts.model_id,voiceId:tts.voice_id,stability:tts.stability,speed:tts.speed}));
  manifest={model:'eleven_v4',voiceId:tts.voice_id,conversationModel:tts.model_id,createdAt:new Date().toISOString(),files:{}};
  await mkdir(directory,{recursive:true});
  for(const [name,text] of Object.entries(texts)){
   const result=await fetch(origin+'/v1/text-to-dialogue?output_format=mp3_44100_128',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({model_id:'eleven_v4',inputs:[{text,voice_id:tts.voice_id}],language_code:'en'}),redirect:'error',signal:AbortSignal.timeout(60000)});
   if(!result.ok)throw Error('PROMPT_'+name.toUpperCase()+'_HTTP_'+result.status);
   if(!/^audio\//.test(result.headers.get('content-type')??''))throw Error('AUDIO_REQUIRED');
   const audio=await bounded(result,2000000);if(audio.length<1000)throw Error('AUDIO_TOO_SHORT');
   await writeFile(directory+'/'+name+'.mp3',audio);manifest.files[name]={text,bytes:audio.length,sha256:hash(audio)};
  }
  await writeFile(directory+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
  console.log('RECEPTION_PROMPTS_GENERATED',JSON.stringify({model:manifest.model,files:3,characters:Object.values(texts).join('').length}));
 }
}catch(error){console.error('RECEPTION_PROMPTS_FAILED',/^[A-Z0-9_]+$/.test(error.message)?error.message:'UNEXPECTED_GENERATION_FAILURE');process.exitCode=1;}
