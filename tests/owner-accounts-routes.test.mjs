import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {currentBotActivity} from '../lib/bot-activity.ts';
import {validActivityReport} from '../lib/activity-report.ts';
import {dealMachinePhoto} from '../lib/property-photo.ts';
import {savedPropertyPhoto} from '../lib/persistent-property-photo.ts';
import * as schemas from '../lib/owner-accounts.ts';
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',session='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222',viewId='33333333-3333-4333-8333-333333333333',screen='44444444-4444-4444-8444-444444444444';
const accountRow={id:account,name:'Fixture customer',email:'fixture@example.invalid',ownAccount:false,fundedCents:25000,balanceCents:12000,reservedCents:100,leadCount:1,paused:true,assistantName:'Bot',createdAt:new Date().toISOString(),billingModel:'membership_credits',vip:false,membership:null};
const view={id:viewId,expiresAt:new Date(Date.now()+60000).toISOString(),account:accountRow};
let user={id:owner},proof=true,binding={sub:owner,session_id:session},active=true,calls=[],media=[],validScreen=true;
const cachedPhoto={url:'https://img.dealmachine.com/sv/35,-90.jpg',fallbackUrl:'https://img.dealmachine.com/sat/35,-90.jpg',view:'street_view',source:'DealMachine'};
const load=(path,deps)=>{const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const module={exports:{}};new Function('require','module','exports',code)(name=>{assert(name in deps,'Missing dependency '+name);return deps[name];},module,module.exports);return module.exports;};
const database={db:async(path,method='GET',body)=>{
 calls.push({path,method,body});
 if(path==='rpc/icash_owner_account_view')return active?structuredClone(view):null;
 if(path==='rpc/icash_owner_account_view_start'){assert.deepEqual(body,{p_actor:owner,p_session:session,p_account:account});return {id:viewId,expiresAt:view.expiresAt};}
 if(path==='rpc/icash_owner_account_view_end')return true;
 if(path==='rpc/icash_owner_accounts')return {sort:body.p_sort,query:body.p_query,page:body.p_page,pageSize:25,total:1,accounts:[accountRow]};
 if(path==='rpc/icash_owner_account_leads'){assert.equal(body.p_account,account);return {page:body.p_page,pageSize:12,query:body.p_query,total:0,leads:[]};}
 if(path==='rpc/icash_activity_report'){assert.equal(body.p_account,account);return {days:body.p_days,timezone:body.p_timezone,startAt:'2026-10-01T00:00:00Z',endAt:'2026-10-02T00:00:00Z',leads:1,calls:2,texts:3,contracts:0};}
 if(path==='rpc/icash_vip_savings'){assert.equal(body.p_account,account);return 100;}
 if(path==='rpc/icash_prospecting_progress'){assert.equal(body.p_account,account);return {status:'paused'};}
 if(path==='rpc/icash_read_photo_cache'){assert.deepEqual(body,{p_account:account,p_screening:screen});return cachedPhoto;}
 assert.equal(method,'GET','Account inspection cannot send writes through arbitrary tables or RPCs');
 assert(path.includes('account_id=eq.'+account),'All nested records stay scoped to the selected account');
 if(path.startsWith('icash_screening_jobs?'))return validScreen?[{id:screen,result:{property:{propertyId:'prop_fixture1',images:null}}}]:[];
 if(path.startsWith('icash_automation_tickets?'))return [];
 if(path.startsWith('icash_live_conversations?'))return [{party:'seller',result:{transcript:[{role:'user',message:'Saved answer'}]}}];
 if(path.startsWith('icash_deal_files?'))return [{id:screen}];
 if(path.startsWith('icash_text_threads?'))return [{id:screen,recipient:'+12025550123',party:'seller'}];
 if(path.startsWith('icash_text_messages?'))return [{id:screen,body:'Saved reply',direction:'incoming',state:'received',created_at:new Date().toISOString()}];
 throw Error('Unexpected query '+path);
}};
const access=load('lib/owner-account-access.ts',{'next/headers':{cookies:async()=>({get:()=>({value:'fixture'})})},'@/lib/dashboard-password':{dashboardCurrentUser:async()=>{if(!proof)throw Error('DASHBOARD_PASSWORD_REQUIRED');return user;}},'@/lib/dashboard-password-policy':{dashboardBinding:()=>binding},'@/lib/owner-inbound-acceptance':{ownerInboundTarget:{ownerUserId:owner}},'@/lib/stripe-test':database,'@/lib/owner-accounts':schemas});
const deps={'zod':{z},'@/lib/owner-account-access':access,'@/lib/owner-accounts':schemas,'@/lib/stripe-test':database,'@/lib/funding-policy':{allowedOrigin:r=>r.headers.get('origin')==='https://app.invalid'},'@/lib/funding':{limitRequest:async()=>{}}};
const directory=load('app/api/admin/accounts/route.ts',deps),start=load('app/api/admin/accounts/view/route.ts',deps),scope=load('app/api/admin/accounts/view/[viewId]/route.ts',deps);
const request=(path='',method='GET',body,origin='https://app.invalid')=>new Request('https://app.invalid/api/admin/accounts'+path,{method,headers:{origin},...(body===undefined?{}:{body:JSON.stringify(body)})});
const context={params:Promise.resolve({viewId})};
for(const principal of [null,{id:session,user_metadata:{isBillingOwner:true}}]){user=principal;const expected=user?403:401;assert.equal((await directory.GET(request())).status,expected);assert.equal((await start.POST(request('/view','POST',{accountId:account}))).status,expected);assert.equal((await scope.GET(request(),context)).status,expected);assert.equal(calls.length,0);}
user={id:owner};proof=false;assert.equal((await directory.GET(request())).status,403);proof=true;binding={sub:session,session_id:session};assert.equal((await directory.GET(request())).status,403);binding={sub:owner,session_id:session};
for(const q of ['?sort=bad','?page=0','?page=100001','?q='+ 'x'.repeat(101),'?sort=funded&sort=leads','?actor='+session])assert.equal((await directory.GET(request(q))).status,400);
assert.equal(calls.length,0);
let response=await directory.GET(request('?sort=leads&q=Fixture&page=1'));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'Cookie');assert.equal(calls[0].body.p_actor,owner);
assert.equal((await start.POST(request('/view','POST',{accountId:account},'https://evil.invalid'))).status,403);
assert.equal((await start.POST(request('/view','POST',{accountId:account,actor:session}))).status,400);
response=await start.POST(request('/view','POST',{accountId:account}));assert.equal(response.status,200);assert.equal((await response.json()).url,'/admin/accounts/'+viewId);assert(!response.headers.has('set-cookie'),'No customer session or credential is installed');
active=false;assert.equal((await scope.GET(request(),context)).status,410);active=true;
assert.equal((await scope.DELETE(request('','DELETE',undefined,'https://evil.invalid'),context)).status,403);
assert.equal((await scope.DELETE(request('','DELETE'),context)).status,200);
const recordings={recordingPresentationById:async(_,a,id)=>{assert.equal(a,account);assert.equal(id,screen);return {id,status:'available'};},recordingPresentation:async()=>null};
const audio=()=>({audio:async(a,id,range)=>{media.push({a,id,range});return new Response(new Uint8Array([1,2]),{status:206,headers:{'Content-Type':'audio/mpeg'}});}});
const resources=load('app/api/admin/accounts/view/[viewId]/[...resource]/route.ts',{...deps,'@/lib/workspace-activity-read':{workspaceActivity:async(req,a,options)=>{assert.equal(a,account);assert.equal(options,undefined,'Inspection cannot enable outcome mutation');return Response.json({properties:[]});}},'@/lib/bot-activity':{currentBotActivity},'@/lib/activity-report':{validActivityReport},'@/lib/property-photo':{dealMachinePhoto},'@/lib/persistent-property-photo':{savedPropertyPhoto},'@/lib/property-call-history':{propertyCallHistory:async(_,a,s,p)=>{assert.equal(a,account);assert.equal(s,screen);return {recordings:[],next:null};}},'@/lib/required-call-recording-receipt':recordings,'@/lib/required-call-recording-server':{recordingServer:audio},'@/lib/recorded-reception-server':{recordedReceptionServer:audio},'@/lib/recorded-reception-presentation':{recordedReceptionPresentation:()=>({})}});
assert.deepEqual(Object.keys(resources).sort(),['GET','dynamic','maxDuration','runtime'],'No customer mutation method is exported');
const get=(resource,query='')=>resources.GET(request('/view/'+viewId+'/'+resource+query),{params:Promise.resolve({viewId,resource:resource.split('/')})});
assert.equal((await get('control')).status,404);assert.equal((await get('../account')).status,404);
assert.equal((await get('leads','?p_account='+session)).status,400);
assert.equal((await get('leads','?page=0')).status,400);
response=await get('leads');assert.equal(response.status,200);
assert.equal((await get('call-history','?screeningId='+screen)).status,200);
assert.equal((await get('conversation','?id='+screen)).status,200);
assert.equal((await get('recording','?id='+screen)).status,200);
response=await get('messages','?screeningId='+screen);assert.equal(response.status,200);assert.equal((await response.json()).messages[0].body,'Saved reply');
assert.equal((await get('messages','?screeningId='+screen+'&threadId='+session)).status,404);
validScreen=false;assert.equal((await get('messages','?screeningId='+screen)).status,404);validScreen=true;
response=await get('recording/audio','?id='+screen);assert.equal(response.status,206);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(media[0].a,account);
for(const resource of ['activity','progress','bot-status','report','property-photo?screeningId='+screen]){const [name,query]=resource.split('?');assert.equal((await get(name,query?'?'+query:'')).status,200,resource);assert.equal((await get(name,'?accountId='+session)).status,400,'Cannot override inspected account');}
response=await get('property-photo','?screeningId='+screen);assert.deepEqual((await response.json()).photo,cachedPhoto,'Owner view reads the existing photo and aerial fallback');
const cacheReads=calls.filter(c=>c.path==='rpc/icash_read_photo_cache').length;validScreen=false;assert.equal((await get('property-photo','?screeningId='+screen)).status,404);validScreen=true;assert.equal(calls.filter(c=>c.path==='rpc/icash_read_photo_cache').length,cacheReads,'A foreign screening cannot read photo cache');
assert.equal((await get('report','?timezone=Invalid')).status,400);
const readCount=calls.length;active=false;assert.equal((await get('recording/audio','?id='+screen)).status,410);assert.equal(media.length,1,'expired view cannot fetch provider media');assert.equal(calls.length,readCount+1,'only session authorization runs for expired views');
console.log('PASS owner account routes: real owner/proof/session only, CSRF, validated inputs, private cache, audited view, no credential replacement or write dispatch, scoped messages/recordings and expiry.');

for(const resource of ['activity','progress','bot-status','report','property-photo'])assert.equal((await get(resource)).status,410,'Ended views cannot read '+resource);
