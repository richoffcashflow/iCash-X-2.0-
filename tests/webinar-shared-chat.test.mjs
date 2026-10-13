import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import * as shared from '../lib/webinar-shared-chat.ts';
const webinarId='00000000-0000-4000-8000-000000000001',sessionId='00000000-0000-4000-8000-000000000002',messageId='00000000-0000-4000-8000-000000000003';
let owner=true,sessionAllowed=true,calls=[],rows=[];
const session={id:sessionId,webinar_id:webinarId,revision:4,is_preview:false,config:{recordingVersion:'night'},superseded_at:null};
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const deps={...shared,z,WebinarError,webinarOrigin(){},webinarHeaders:{'Cache-Control':'private, no-store'},webinarBody:r=>r.json(),webinarError:e=>Response.json({error:e.message},{status:e.status||500}),webinarOwner:async()=>{if(!owner)throw new WebinarError(403,'Owner only');},webinarSession:async()=>{if(!sessionAllowed)throw new WebinarError(404,'Session not found');return {v:{id:'visitor'},s:session};},webinarLimit:async()=>{},db:async(path,method='GET',body)=>{
 calls.push({path,method,body});const q=new URL('https://db.test/'+path).searchParams;
 let found=rows.filter(row=>[...q].every(([key,value])=>{
  if(['select','order','limit'].includes(key))return true;
  if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
  if(value.startsWith('in.('))return value.slice(4,-1).split(',').includes(row[key]);
  return true;
 }));
 if(method==='PATCH')found.forEach(row=>Object.assign(row,body));
 return found.map(row=>q.get('select')?Object.fromEntries(q.get('select').split(',').map(k=>[k,row[k]])):{...row});
}};
async function load(path){globalThis.chatRouteDeps=deps;const source=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.chatRouteDeps;\n'+source).toString('base64'));}
const feed=await load('app/api/webinar/chat/feed/route.ts'),moderation=await load('app/api/webinar/chat/moderation/route.ts');
const req=body=>new Request('https://app.test/api/webinar/chat/feed',{method:'POST',body:JSON.stringify(body)});
const getFeed=async()=>feed.POST(req({sessionId}));
const change=(id,action)=>moderation.PATCH(req({id,action}));
const base={id:messageId,session_id:'someone-else',role:'user',text:'Useful question',display_name:'Casey',playback_seconds:20,public_status:'pending',webinar_id:webinarId,webinar_revision:4,recording_version:'night',is_preview:false,created_at:'2026-10-13T07:00:00Z',email:'private@example.invalid'};
rows=[{...base},{...base,id:'private',public_status:'private'},{...base,id:'preview',is_preview:true,public_status:'approved'},{...base,id:'other-webinar',webinar_id:'other',public_status:'approved'},{...base,id:'day',recording_version:'day',public_status:'approved'},{...base,id:'old-revision',webinar_revision:3,public_status:'approved'}];
assert.deepEqual((await(await getFeed()).json()).messages,[],'Pending, private, other recordings, revisions and previews stay out of the feed');
owner=false;let count=calls.length;assert.equal((await change(messageId,'approve')).status,403);assert.equal(calls.length,count);
assert.equal((await moderation.GET(new Request(`https://app.test/moderation?webinarId=${webinarId}&version=night&status=pending`))).status,403);assert.equal(calls.length,count);
owner=true;assert.equal((await change(messageId,'approve')).status,200);let response=await getFeed(),data=await response.json();assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(data.messages.length,1);assert.equal(data.messages[0].text,'Useful question');assert.equal(data.messages[0].display_name,'Casey');assert.equal(data.messages[0].session_id,undefined);assert.equal(data.messages[0].email,undefined);
assert.equal((await change(messageId,'hide')).status,200);assert.deepEqual((await(await getFeed()).json()).messages,[],'Hiding removes an already shared message');
assert.equal((await change(messageId,'approve')).status,200);rows[0].session_id=sessionId;data=await(await getFeed()).json();assert.equal(data.messages.length,0,'Sender does not receive a duplicate of their own message');assert.deepEqual(data.statuses,[{id:messageId,public_status:'approved'}]);
rows[0].public_status='private';assert.equal((await change(messageId,'approve')).status,404,'Legacy private messages can never be approved');
sessionAllowed=false;count=calls.length;assert.equal((await getFeed()).status,404);assert.equal(calls.length,count,'Unowned sessions never read shared chat');sessionAllowed=true;
session.superseded_at='2026-10-13T07:01:00Z';assert.deepEqual((await(await getFeed()).json()).messages,[]);session.superseded_at=null;
session.is_preview=true;data=await(await getFeed()).json();assert.deepEqual(data.messages.map(m=>m.id),['preview'],'Owner preview feed is isolated from live customer messages');
console.log('PASS review-before-sharing, owner authorization, no private backfill, approved/hide/restore flow, session and recording isolation, preview separation, sender deduplication and safe public fields.');
