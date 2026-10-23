// Local audio-history fixtures only. No provider calls or paid work.
import assert from 'node:assert/strict';
import test from 'node:test';
import {propertyCallHistory} from '../lib/property-call-history.ts';
import {recordingAudioPresentation,recordingPresentationById} from '../lib/required-call-recording-receipt.ts';
import {uuid,privateHeaders} from '../lib/required-call-recording.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

globalThis.fetch=async()=>{throw Error('UNEXPECTED_EXTERNAL_NETWORK');};
const account='11111111-1111-4111-8111-111111111111',screen='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',foreign='44444444-4444-4444-8444-444444444444',conversation='55555555-5555-4555-8555-555555555555';
const now=Date.parse('2026-10-16T06:00:00Z'),createdAt='2026-10-16T05:00:00Z';
const fixture=(overrides={})=>({id,account_id:account,screening_id:screen,operation_key:'voice:'+id,party:'seller',created_at:createdAt,state:'available',duration_seconds:42,audio_expires_at:'2026-11-15T05:00:00Z',recording_sid:'RE'+'a'.repeat(32),consent_at:null,entry_policy:'direct_recorded_v1',recording_authorized_at:createdAt,deleted_at:null,conversation_id:null,nonce_hash:'private-nonce',stop_token_hash:'private-capability',from_phone:'+12125550123',provider_account_sid:'AC'+'b'.repeat(32),...overrides});

test('actual recording appears without an AI conversation, with exact property ownership and no provider details',async()=>{
 const calls=[];
 const db=async path=>{calls.push(path);if(path.startsWith('icash_screening_jobs?'))return [{id:screen}];if(path.startsWith('icash_call_recordings?'))return [fixture()];if(path.startsWith('icash_live_conversations?'))return [];throw Error(path);};
 const result=await propertyCallHistory(db,account,screen,0,now);
 assert.equal(result.recordings.length,1);assert.deepEqual(result.recordings[0],{id,status:'available',createdAt,durationSeconds:42,audioAvailable:true,audioExpiresAt:'2026-11-15T05:00:00Z',source:'outbound',party:'seller',conversationId:null});assert.equal(result.next,null);
 for(const path of calls){const query=new URLSearchParams(path.split('?')[1]);assert.equal(query.get('account_id'),'eq.'+account);if(path.startsWith('icash_screening_jobs?'))assert.equal(query.get('id'),'eq.'+screen);else assert.equal(query.get('screening_id'),'eq.'+screen);}
 assert(!JSON.stringify(result).match(/private-nonce|private-capability|provider_account_sid|recording_sid|from_phone|conv_/));
 assert(!calls.find(p=>p.startsWith('icash_call_recordings?')).includes('state=eq.complete'));
});

test('only exact completed conversation binding is added; foreign properties and corrupt account rows fail closed',async()=>{
 let rows=[fixture({conversation_id:'conv_fixture'})],screens=[{id:screen}],calls=[{id:conversation,account_id:account,screening_id:screen,operation_key:'voice:'+id,conversation_id:'conv_fixture'}];
 const db=async path=>path.startsWith('icash_screening_jobs?')?screens:path.startsWith('icash_call_recordings?')?rows:calls;
 assert.equal((await propertyCallHistory(db,account,screen,0,now)).recordings[0].conversationId,conversation);
 screens=[];assert.equal(await propertyCallHistory(db,account,screen,0,now),null);screens=[{id:screen}];
 for(const bad of [{account_id:foreign},{screening_id:foreign},{operation_key:'voice:'+id+',or=(true)'}]){rows=[fixture(bad)];await assert.rejects(propertyCallHistory(db,account,screen,0,now));}
 rows=[fixture({conversation_id:'conv_fixture'})];calls=[{...calls[0],account_id:foreign}];await assert.rejects(propertyCallHistory(db,account,screen,0,now));
});

test('history is bounded and later pages retain recordings independently of transcript pagination',async()=>{
 const ids=Array.from({length:21},(_,n)=>'33333333-3333-4333-8333-'+String(n).padStart(12,'0'));let query;
 const db=async path=>{if(path.startsWith('icash_screening_jobs?'))return [{id:screen}];if(path.startsWith('icash_call_recordings?')){query=new URLSearchParams(path.split('?')[1]);return ids.map(id=>fixture({id,operation_key:'voice:'+id}));}return [];};
 const result=await propertyCallHistory(db,account,screen,2,now);assert.equal(result.recordings.length,20);assert.equal(result.next,3);assert.equal(query.get('limit'),'21');assert.equal(query.get('offset'),'40');assert.equal(query.get('order'),'created_at.desc,id.desc');
 for(const page of [-1,1.1,10001])await assert.rejects(propertyCallHistory(db,account,screen,page,now));
});

test('audio state requires authorization, retained media and availability, never a transcript',async()=>{
 for(const [change,status] of [[{state:'stopping'},'stopping'],[{recording_authorized_at:null},'processing'],[{recording_sid:null},'processing'],[{audio_expires_at:createdAt},'expired'],[{state:'deleted',deleted_at:createdAt},'deleted']]){const receipt=recordingAudioPresentation(fixture(change),now);assert.equal(receipt.audioAvailable,false);assert.equal(receipt.status,status);}
 assert.equal(recordingAudioPresentation(fixture(),now).audioAvailable,true);
 assert.equal(await recordingPresentationById(async()=>[fixture({account_id:foreign})],account,id,now),null);
 assert.equal((await recordingPresentationById(async path=>{assert.match(path,new RegExp('account_id=eq.'+account));return [fixture()];},account,id,now)).audioAvailable,true);
});

test('history API authenticates before lookup and rejects extra account filters and duplicate parameters',async()=>{
 let signedIn=true,enabled=true;const calls=[];const env={ICASH_RECORDING_RECEIPTS_READY:'true'};
 const route=await loadService('app/api/work/call-history/route.ts',{uuid,privateHeaders,process:{env},db:{fixture:true},workAccount:async()=>{if(!signedIn)throw Error('PRIVATE_AUTH_ERROR');return {accountId:account};},propertyCallHistory:async(...args)=>{calls.push(args);return enabled?{recordings:[],next:null}:null;}});
 const request=query=>new Request('https://www.geticashx.com/api/work/call-history'+query);
 for(const query of ['', '?screeningId=invalid','?screeningId='+screen+'&accountId='+foreign,'?screeningId='+screen+'&screeningId='+foreign,'?screeningId='+screen+'&page=-1','?screeningId='+screen+'&page=10001','?screeningId='+screen+'&page=1&page=2'])assert.equal((await route.GET(request(query))).status,400);
 assert.equal(calls.length,0);
 let response=await route.GET(request('?screeningId='+screen+'&page=2'));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),privateHeaders['Cache-Control']);assert.deepEqual(calls[0].slice(1),[account,screen,2]);
 env.ICASH_RECORDING_RECEIPTS_READY='false';response=await route.GET(request('?screeningId='+screen));assert.deepEqual(await response.json(),{recordings:[],next:null});assert.equal(calls.length,1);
 env.ICASH_RECORDING_RECEIPTS_READY='true';enabled=false;assert.equal((await route.GET(request('?screeningId='+screen))).status,404);
 signedIn=false;response=await route.GET(request('?screeningId='+screen));assert.equal(response.status,503);assert(!JSON.stringify(await response.json()).includes('PRIVATE_AUTH_ERROR'));
});

test('independent receipt and media endpoints keep authenticated account binding and range playback',async()=>{
 const events=[],workAccount=async()=>({accountId:account});
 const receiptRoute=await loadService('app/api/work/recording/route.ts',{uuid,privateHeaders,workAccount,db:{fixture:true},process:{env:{ICASH_RECORDING_RECEIPTS_READY:'true'}},recordingPresentation:async(...args)=>{events.push(['conversation',...args.slice(1)]);return {status:'not_recorded'};},recordingPresentationById:async(...args)=>{events.push(['recording',...args.slice(1)]);return recordingAudioPresentation(fixture(),now);}});
 const request=query=>new Request('https://www.geticashx.com/api/work/recording'+query);
 assert.equal((await receiptRoute.GET(request('?id='+id))).status,200);assert.deepEqual(events[0],['recording',account,id]);
 assert.equal((await receiptRoute.GET(request('?conversationId='+conversation))).status,200);assert.deepEqual(events[1],['conversation',account,conversation]);
 for(const query of ['?id='+id+'&accountId='+foreign,'?id='+id+'&id='+foreign,'?id='+id+'&conversationId='+conversation])assert.equal((await receiptRoute.GET(request(query))).status,400);
 const audioRoute=await loadService('app/api/work/recording/audio/route.ts',{uuid,privateHeaders,workAccount,recordingServer:signal=>({audio:async(...args)=>{events.push({signal,args});return new Response('audi',{status:206,headers:privateHeaders});}})});
 const cancel=new AbortController();
 const mediaRequest=new Request('https://www.geticashx.com/api/work/recording/audio?id='+id,{headers:{range:'bytes=0-3'},signal:cancel.signal});
 assert.equal((await audioRoute.GET(mediaRequest)).status,206);assert.deepEqual(events.at(-1).args,[account,id,'bytes=0-3']);assert.equal(events.at(-1).signal.aborted,false);
 cancel.abort();assert.equal(events.at(-1).signal.aborted,true,'Client disconnect cancels the shared media deadline');
 assert.equal((await audioRoute.GET(new Request(mediaRequest.url+'&accountId='+foreign))).status,404);
});

// Missing audio is not a failed lead. Only a bound carrier receipt can explain it.
test('unanswered calls stay distinct from failures and mismatched provider receipts',async()=>{
 const callSid='CA'+'c'.repeat(32);
 const row=fixture({state:'failed',call_sid:callSid,recording_sid:null,conversation_id:null,duration_seconds:null,audio_expires_at:null});
 let terminal={recording_id:id,account_id:account,call_sid:callSid,outcome:'no-answer'};
 const db=async path=>{
  if(path.startsWith('icash_screening_jobs?'))return [{id:screen}];
  if(path.startsWith('icash_call_recordings?'))return [row];
  if(path.startsWith('icash_live_conversations?'))return [];
  const q=new URLSearchParams(path.split('?')[1]);
  assert(path.startsWith('icash_recorded_gate_terminal_receipts?'));assert.equal(q.get('account_id'),'eq.'+account);assert.equal(q.get('recording_id'),'in.('+id+')');
  return terminal?[terminal]:[];
 };
 let result=await propertyCallHistory(db,account,screen,0,now);
 assert.equal(result.recordings[0].callOutcome,'no-answer');assert.equal(result.recordings[0].status,'failed','the original recording status remains intact');
 assert(!JSON.stringify(result).includes(callSid),'provider identifiers remain private');
 terminal.outcome='busy';assert.equal((await propertyCallHistory(db,account,screen,0,now)).recordings[0].callOutcome,'busy');
 terminal.outcome='failed';assert.equal((await propertyCallHistory(db,account,screen,0,now)).recordings[0].callOutcome,undefined);
 for(const change of [{account_id:foreign},{recording_id:foreign},{call_sid:'CA'+'d'.repeat(32)}]){
  terminal={recording_id:id,account_id:account,call_sid:callSid,outcome:'no-answer',...change};await assert.rejects(propertyCallHistory(db,account,screen,0,now),/OWNED_CALL_OUTCOME_REQUIRED/);
 }
 terminal=null;assert.equal((await propertyCallHistory(db,account,screen,0,now)).recordings[0].callOutcome,undefined);
});
