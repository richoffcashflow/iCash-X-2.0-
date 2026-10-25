import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
process.env.ICASH_WEBINAR_SECRET='fixture-only';
let signedIn=true,exists=true,version='night',supersededAt=null;
const calls=[],visitor={id:'visitor'},config={recordingVersion:'night',videoUrl:'https://example.invalid/video.mp4',chat:Array(100).fill({text:'Saved snapshot'})};
const {webinarSession,WebinarError}=await loadService('lib/webinar-server.ts',{
 cookies:async()=>({get:()=>({value:'fixture'})}),readWebinarToken:(_token,purpose)=>signedIn&&purpose==='visitor'?'visitor':null,
 db:async path=>{
  calls.push(path);
  if(path.startsWith('icash_webinar_visitors'))return [visitor];
  const params=new URLSearchParams(path.split('?')[1]);
  assert.equal(params.get('id'),'eq.session');assert.equal(params.get('visitor_id'),'eq.visitor');assert.equal(params.get('limit'),'1');
  if(!exists)return [];
  const row={id:'session',visitor_id:'visitor',webinar_id:'webinar',revision:7,is_preview:false,superseded_at:supersededAt};
  if(params.get('select')==='*')return [{...row,config}];
  assert.equal(params.get('select'),'id,visitor_id,webinar_id,revision,is_preview,superseded_at,recording_version:config->>recordingVersion');
  return [{...row,recording_version:version}];
 }
});
let result=await webinarSession('session',true);
assert.equal(result.v,visitor);assert.deepEqual(result.s.config,{recordingVersion:'night'});assert.equal(result.s.revision,7);
supersededAt='2026-10-25T00:00:00Z';version=null;
result=await webinarSession('session',true);assert.equal(result.s.superseded_at,supersededAt);assert.deepEqual(result.s.config,{recordingVersion:'day'});
assert.equal(calls.filter(p=>p.startsWith('icash_webinar_visitors')).length,2,'Authorization is checked on every poll');
assert.equal((await webinarSession('session')).s.config,config,'Full session consumers retain their immutable snapshot');
exists=false;await assert.rejects(webinarSession('session',true),e=>e instanceof WebinarError&&e.status===404);
signedIn=false;calls.length=0;await assert.rejects(webinarSession('session',true),e=>e instanceof WebinarError&&e.status===401);assert.equal(calls.length,0);
console.log('Webinar summary reads preserve fresh ownership, supersession, preview and recording scope without full snapshot transfer.');
