import {webinarViewerLocation} from '../lib/webinar-viewer-location.ts';
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';import {randomUUID,randomBytes} from 'node:crypto';
import * as policy from '../lib/webinar-policy.ts';import {selectRecording,createNightRecording} from '../lib/webinar-recordings.ts';import {selectOffer} from '../packages/webinar-engine/src/index.ts';import {snapshotChat} from '../lib/webinar-variants.ts';import {returnVisit} from '../lib/webinar-optimizer.ts';
const id=randomUUID(),visitor={id:randomUUID(),name:'Casey',email:'casey@example.invalid',phone:'+12125550100'},base={...policy.newWebinar(id),status:'published',publicCode:'129339',videoUrl:'https://example.test/day.mp4'},settings=policy.settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c']});
let configured={...base},calls=[],owner=true,failChat=false,rowsPresent=true;
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
const deps={webinarViewerLocation,...policy,adReturnWebinar:async()=>{throw Error('New, preview and unavailable entries must not select alternatives');},webinarReturnJourney:(history,events,zone,hours)=>returnVisit(history,zone,hours),z,randomUUID,randomBytes,selectRecording,selectOffer,snapshotChat,returnVisit,approximateRegion:()=>null,webinarSite:{workspacePath:'/'},webinarHeaders:{'Cache-Control':'private, no-store'},WebinarError,webinarBody:req=>req.json(),webinarOrigin:()=>{},webinarLimit:async()=>{},webinarOwner:async()=>{if(!owner)throw new WebinarError(403,'Owner only');},webinarVisitor:async()=>visitor,webinarCustomerAccount:async()=>null,webinarPaid:async()=>false,webinarCustomerPaid:async()=>false,validGuest:()=>true,guestHash:()=> 'bound-guest',cookies:async()=>({get:()=>({value:'guest'}),set:()=>{}}),webinarError:e=>Response.json({error:e.message},{status:e.status||503}),db:async(path,method,body)=>{
 calls.push({path,method,body});
 if(path.startsWith('icash_webinars?'))return rowsPresent?[{config:configured,public_code:129339}]:[];
 if(path.startsWith('icash_webinar_sessions?')||path.startsWith('icash_webinar_events?'))return [];
 if(path.startsWith('icash_webinar_settings?'))return [{config:settings}];
 if(path==='rpc/icash_webinar_begin')return {id:body.p_id,config:body.p_config,completed_at:null,progress_seconds:0};
 if(path.startsWith('icash_webinar_messages?')){if(failChat)throw Error('chat unavailable');return [];}
 return {};
}};
globalThis.__entryRoute=deps;const source=ts.transpileModule(readFileSync(new URL('../app/api/webinar/start/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__entryRoute;\n'+source).toString('base64'));
const post=body=>POST(new Request('https://example.test/api/webinar/start',{method:'POST',body:JSON.stringify({timezone:'America/Chicago',...body})}));
let response=await post({code:'129339'}),data=await response.json();assert.equal(response.status,200);assert.equal(data.name,'Casey');assert.equal(data.email,visitor.email);assert.equal(data.phone,visitor.phone);assert.equal(data.contactSaved,true);assert.ok(calls.some(c=>c.path.startsWith('icash_webinars?public_code=eq.129339&')));assert.ok(calls.some(c=>c.path.includes('webinar_id=eq.'+id)));assert.equal(data.webinar.recordingVersion,'day');
rowsPresent=false;data=await(await post({code:'999999'})).json();assert.equal(data.unavailable,true);rowsPresent=true;
configured={...base,status:'draft'};data=await(await post({code:'129339'})).json();assert.equal(data.unavailable,true);
configured={...base,nightEnabled:true,nightVersion:{...createNightRecording(base),videoUrl:'https://example.test/night.mp4',faq:'PRIVATE NIGHT'}};owner=false;assert.equal((await post({preview:id,variant:'night'})).status,403);owner=true;
failChat=true;data=await(await post({preview:id,variant:'night'})).json();assert.equal(data.webinar.videoUrl,configured.nightVersion.videoUrl);assert.equal(data.webinar.recordingVersion,'night');assert.deepEqual(data.messages,[]);assert.ok(!JSON.stringify(data).includes('PRIVATE NIGHT'));
assert.equal((await post({code:'../../evil'})).status,400);
console.log('PASS entry route: exact permanent link, scoped history, remembered details, draft/missing links, owner-only Night preview, private sources and video entry through chat outage.');
