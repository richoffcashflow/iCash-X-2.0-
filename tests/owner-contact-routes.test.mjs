import assert from 'node:assert/strict';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,viewId=id(1),threadId=id(2),owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',accountId=id(3);
const access={viewId,userId:owner,accountId,sessionId:id(4)},headers={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer'};
let authenticated=true,enabled=true,origin=true,ended=false,reads=0,actions=[],dispatches=0;
class OwnerViewError extends Error{constructor(status,message){super(message);this.status=status;}}
const db=async(path,method,body)=>{if(path==='rpc/icash_owner_contact_actions_enabled')return enabled;if(path==='rpc/icash_owner_contact_end_account')return body.p_call===id(9)?accountId:null;if(path==='rpc/icash_owner_contact_action'){actions.push(body);return {id:id(5),manual:true};}throw Error(path);};
const accessModule=await loadService('lib/owner-contact-access.ts',{db,OwnerViewError,ownerAccountActor:async()=>{if(!authenticated)throw new OwnerViewError(403,'Owner required');return access;},ownerAccountView:async v=>{if(!authenticated)throw new OwnerViewError(403,'Owner required');if(ended||v!==viewId)throw new OwnerViewError(410,'Expired');return {actor:access,view:{account:{id:accountId}}};}});
const handlers=await loadService('lib/owner-contact-handlers.ts',{NextResponse:{json:(b,o)=>Response.json(b,o)},z,allowedOrigin:()=>origin,db,ownerContactAction:accessModule.ownerContactAction,dispatchTextMessage:async(a,id,manual)=>{assert.equal(a,accountId);assert.equal(id,id5());assert.equal(manual,true);dispatches++;return {status:'message_accepted'};},customerTextStatus:async()=>({status:'message_accepted'}),dealTermsSchema:z.object({})});function id5(){return id(5);}
const read=async(req,a)=>{reads++;assert.deepEqual(a,access);return Response.json({scoped:true});};
const route=await loadService('app/api/admin/accounts/view/[viewId]/contact/[...action]/route.ts',{z,allowedOrigin:()=>origin,...accessModule,ownerViewHeaders:headers,ownerViewFailure:e=>Response.json({error:e.message},{status:e.status??503,headers}),messagesGET:read,messagesPOST:handlers.messagesPOST,availabilityGET:read,textContactGET:read,textContactPOST:handlers.textContactPOST,manualCallGET:read,browserCallGET:read,browserCallPOST:async(req,a)=>{assert.deepEqual(a,access);const b=await req.json();await accessModule.ownerContactAction(a,'end_call',{p_id:b.id});return Response.json({ended:true});},businessCallGET:read});
const request=(method,body)=>new Request('https://fixture.invalid',{method,...(body?{body:JSON.stringify(body)}:{})}),context=(action,v=viewId)=>({params:Promise.resolve({viewId:v,action:action.split('/')})});
let response=await route.GET(request('GET'),context('messages'));assert.equal(response.status,200);for(const [k,v] of Object.entries(headers))assert.equal(response.headers.get(k),v);
authenticated=false;assert.equal((await route.GET(request('GET'),context('messages'))).status,403);authenticated=true;
assert.equal((await route.GET(request('GET'),context('messages',id(8)))).status,410);assert.equal(reads,1);
const send={threadId,requestKey:id(6),message:'Fixture manual reply'};
origin=false;assert.equal((await route.POST(request('POST',send),context('messages'))).status,403);assert.equal(actions.length,0);origin=true;
enabled=false;assert.equal((await route.POST(request('POST',send),context('messages'))).status,409);enabled=true;
for(const payload of [{...send,accountId:id(8)},{...send,actor:owner},{...send,message:'x'.repeat(1001)}])assert.equal((await route.POST(request('POST',payload),context('messages'))).status,409);
assert.equal(dispatches,0);response=await route.POST(request('POST',send),context('messages'));assert.equal(response.status,200);assert.equal(dispatches,1);assert.deepEqual(actions[0],{p_actor:owner,p_session:access.sessionId,p_view:viewId,p_account:accountId,p_action:'text',p_request:{p_actor:owner,p_account:accountId,p_thread:threadId,p_key:id(6),p_body:'Fixture manual reply',p_assets:[]}});
for(const action of ['control/pause','funding','messages/read','manual-call'])assert.equal((await route.POST(request('POST',send),context(action))).status,404);
assert.equal((await route.POST(request('POST',{action:'pause',screeningId:id(7)}),context('control'))).status,503);
ended=true;assert.equal((await route.POST(request('POST',send),context('messages'))).status,410);assert.equal((await route.POST(request('POST',{action:'end',id:id(9)}),context('browser-call'))).status,200);assert.equal((await route.POST(request('POST',{action:'end',id:id(8)}),context('browser-call'))).status,403);
assert.equal((await route.POST(request('POST',{action:'end',id:id(9),junk:'x'.repeat(1100)}),context('browser-call'))).status,503);
console.log('PASS owner contact routes: verified owner/view scope, private headers, strict payloads, origin, feature flag, selected-account dispatch and exact-call hangup after view expiry.');
