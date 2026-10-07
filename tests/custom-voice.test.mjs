import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import * as policy from '../lib/custom-voice-policy.ts';
const id='00000000-0000-4000-8000-000000000001';
const sample=new Uint8Array(1500);sample.set([73,68,51]);
assert.equal(policy.sampleFormat(sample).extension,'mp3');
assert.throws(()=>policy.sampleFormat(new Uint8Array(1500)));
assert.throws(()=>policy.sampleFormat(new Uint8Array(4000001)));
let row,vip,uploads,result,fail,canonical;
function reset(){row=null;vip=true;uploads=0;fail=false;result={voice_id:'voice_fixture',requires_verification:false};canonical={voice_id:'voice_fixture',name:policy.providerVoiceName(id),category:'cloned',is_owner:true,voice_verification:{requires_verification:false}};}
const db=async(path,method,body)=>{
 if(path==='rpc/icash_vip_active')return vip;
 if(path==='rpc/icash_vip_call_voice')return vip&&row?.enabled&&row.state==='ready'?row.voice_id:null;
 if(path==='rpc/icash_begin_custom_voice'){assert.equal(body.p_consent,policy.ownVoiceConsentVersion);if(!vip)throw Error('VIP required');if(row)return {started:false,voice:{...row}};row={id,account_id:'account',state:'creating',voice_id:null,enabled:true,created_at:new Date().toISOString()};return {started:true,voice:{...row}};}
 if(path.startsWith('icash_custom_voices')){if(method==='PATCH')Object.assign(row,body);return row?[{...row}]:[];}
 throw Error(path);
};
const elevenRequest=async(path)=>path==='/v1/voices'?{voices:[canonical]}:canonical;
const fetcher=async(url,init)=>{uploads++;assert.equal(url,'https://api.elevenlabs.io/v1/voices/add');assert(init.body instanceof FormData);assert.equal(init.body.get('name'),policy.providerVoiceName(id));assert.equal(init.body.get('files').size,1500);assert(!init.headers['Content-Type'],'Fetch supplies multipart boundary');if(fail)throw Error('network timeout');return Response.json(result);};
process.env.ELEVENLABS_API_KEY='fixture-key';
const deps={...policy,db,elevenRequest,createHash};globalThis.__customVoice=deps;
const code=ts.transpileModule(readFileSync(new URL('../lib/custom-voice.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const api=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__customVoice;\n'+code).toString('base64'));
reset();await api.createCustomVoice('account','user',sample,policy.ownVoiceConsentVersion,fetcher);assert.equal(row.state,'ready');assert.equal(await api.selectedCustomCallVoice('account'),'voice_fixture');
await api.createCustomVoice('account','user',sample,policy.ownVoiceConsentVersion,fetcher);assert.equal(uploads,1,'Double click cannot create a second voice');
vip=false;assert.equal(await api.selectedCustomCallVoice('account'),null,'Expiry restores normal voice');vip=true;row.enabled=false;assert.equal(await api.selectedCustomCallVoice('account'),null);
row.enabled=true;canonical.name='another-account';assert.equal(await api.selectedCustomCallVoice('account'),null,'Provider account binding checked');
reset();result.requires_verification=true;canonical.voice_verification={requires_verification:true,is_verified:false};await api.createCustomVoice('account','user',sample,policy.ownVoiceConsentVersion,fetcher);assert.equal(row.state,'verification_required');assert.equal(await api.selectedCustomCallVoice('account'),null,'Never bypass provider verification');
reset();fail=true;canonical.name='unrelated';await api.createCustomVoice('account','user',sample,policy.ownVoiceConsentVersion,fetcher);assert.equal(row.state,'unknown');await api.createCustomVoice('account','user',sample,policy.ownVoiceConsentVersion,fetcher);assert.equal(uploads,1,'Unknown provider write is never retried');canonical.name=policy.providerVoiceName(id);assert.equal((await api.customVoiceStatus('account')).state,'ready','Recover provider success after timeout');
reset();await assert.rejects(api.createCustomVoice('account','user',sample,'wrong-consent',fetcher));assert.equal(uploads,0);vip=false;await assert.rejects(api.createCustomVoice('account','user',sample,policy.ownVoiceConsentVersion,fetcher));assert.equal(uploads,0);
console.log('PASS custom voice: validated audio, account binding, VIP expiry, verification, duplicate upload and timeout recovery');
