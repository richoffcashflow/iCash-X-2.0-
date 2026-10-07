// Verify committed Eleven v4 prompt assets. No network or generation requests.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory='public/audio/reception-v4-20261007';
const texts={
 notice:"Hi, I'm the receptionist, the AI assistant for iCash X. We save a transcript and keep audio private for 30 days.",
 question:'Is it okay to record?',
 goodbye:"Okay, I won't record a conversation without your permission. Take care.",
};
const hash=x=>createHash('sha256').update(x).digest('hex');
const manifest=JSON.parse(await readFile(directory+'/manifest.json','utf8'));
if(manifest.model!=='eleven_v4'||manifest.voiceId!=='cjVigY5qzO86Huf0OWal')throw Error('PROMPT_MODEL_OR_VOICE_MISMATCH');
for(const [name,text] of Object.entries(texts)){
 const audio=await readFile(directory+'/'+name+'.mp3');
 if(manifest.files[name]?.text!==text||manifest.files[name]?.bytes!==audio.length||manifest.files[name]?.sha256!==hash(audio))throw Error('PROMPT_ASSET_MISMATCH');
}
console.log('Verified three committed Eleven v4 prompts; no generation requests.');
