import assert from 'node:assert/strict';
import {z} from 'zod';
import {identityNames,chooseAccountVoice,readReviewedAccountVoices} from '../lib/customer-identity.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
let existing=false,expired=false,change=false,reads=0,writes=[],providerReads=0;
const review=()=>({enabled:true,reviewed_at:new Date(Date.now()-10000).toISOString(),reviewed_until:new Date(Date.now()+(expired?-1000:100000)).toISOString(),approved_voice_ids:change&&reads>1?['SarahId']:['EricId']});
const route=await loadService('app/api/account/identity/route.ts',{
 z,identityNames,chooseAccountVoice,readReviewedAccountVoices,NextResponse:{json:Response.json},currentUser:async()=>({id:'user'}),allowedOrigin:()=>true,normalizeUpdatePhone:s=>s,
 setupVoices:async()=>[{key:'sarah',voiceId:'SarahId',name:'Sarah'}],elevenRequest:async()=>{providerReads++;return {voices:[{voice_id:'SarahId',name:'Sarah',category:'premade'},{voice_id:'EricId',name:'Eric',category:'premade'}]};},
 db:async(path,method,body)=>{
  if(method){writes.push({path,body});return body;}
  if(path.startsWith('icash_accounts'))return [{id:'account'}];
  if(path.startsWith('icash_customer_identities'))return existing?[{voice_id:'historical',voice_name:'Saved voice'}]:[];
  if(path.startsWith('icash_bot_setups'))return [{profile:{voice:'sarah'}}];
  if(path.startsWith('icash_voice_production_template')){reads++;return [review()];}
  throw Error(path);
 }
});
const run=()=>route.POST(new Request('https://www.geticashx.com/api/account/identity',{method:'POST',body:JSON.stringify({company_name:'Fixture buyer'})}));
assert.equal((await run()).status,200);assert.equal(writes[0].body.p_voice,'EricId');assert.equal(reads,2);assert.equal(providerReads,1);
writes=[];reads=0;change=true;assert.equal((await run()).status,503);assert.equal(writes.length,0,'changed approval cannot save after catalog request');
change=false;expired=true;writes=[];reads=0;providerReads=0;assert.equal((await run()).status,503);assert.equal(writes.length,0);assert.equal(providerReads,0,'expired review does not even fetch a catalog');
existing=true;writes=[];reads=0;assert.equal((await run()).status,200);assert.equal(writes[0].body.p_voice,'historical');assert.equal(reads,0,'existing identities do not depend on template renewal');assert.equal(providerReads,0);
console.log('Identity route: reviewed new voice, stale preset fallback, rechecked approval, expired fail-closed and historical-voice preservation passed.');
const beforeFetch=globalThis.fetch,beforeKey=process.env.ELEVENLABS_API_KEY;process.env.ELEVENLABS_API_KEY='fixture';let approved=['EricId'],catalogRequests=0;
globalThis.fetch=async()=>{catalogRequests++;return Response.json({voices:[{voice_id:'EricId',name:'Eric - Calm',category:'premade',preview_url:'https://api.elevenlabs.io/eric.mp3'},{voice_id:'SarahId',name:'Sarah - Warm',category:'premade',preview_url:'https://api.elevenlabs.io/sarah.mp3'}]});};
try{
 const catalog=await loadService('lib/setup-voices.ts',{unstable_cache:fn=>fn,db:()=>{},readReviewedAccountVoices:async()=>approved});
 const voices=await catalog.setupVoices();assert.deepEqual(voices.map(v=>v.voiceId),['EricId']);assert.equal(voices[0].key,'eric');
 approved=[];assert.deepEqual(await catalog.setupVoices(),[]);assert.equal(catalogRequests,1,'disabled review does not load previews');
}finally{globalThis.fetch=beforeFetch;if(beforeKey===undefined)delete process.env.ELEVENLABS_API_KEY;else process.env.ELEVENLABS_API_KEY=beforeKey;}
console.log('Voice preview choices use the same current allowlist and never offer an unapproved voice.');
