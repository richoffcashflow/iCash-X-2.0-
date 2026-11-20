import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {dashboardCookie,issueDashboardProof,validDashboardProof} from '../lib/dashboard-password-policy.ts';

// Exercise the real auth -> dashboard -> webinar adapter -> Server Component
// chain with Next's read-only rendering cookie contract and fictional Auth.
let moduleId=0;
async function load(path,deps){
 const key='webinarPreviewAuth'+moduleId++;globalThis[key]=deps;
 const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\s*$/gm,'');
 try{return await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+code).toString('base64'));}finally{delete globalThis[key];}
}
const ownerId='00000000-0000-4000-8000-000000000001',webinarId='00000000-0000-4000-8000-000000000002';
const sessionId='00000000-0000-4000-8000-000000000003',secret='fictional-preview-auth-key-never-production';
const access=id=>'header.'+Buffer.from(JSON.stringify({sub:id,session_id:sessionId})).toString('base64url')+'.signature';
const originalEnv={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY,WEBINAR_OWNER_USER_ID:process.env.WEBINAR_OWNER_USER_ID};
process.env.SUPABASE_URL='https://auth.example.invalid';process.env.SUPABASE_SECRET_KEY=secret;process.env.WEBINAR_OWNER_USER_ID=ownerId;
let jar,readOnly,identity,accessStatus,refreshStatus,requests,writes;
function reset(){
 identity={id:ownerId,email_confirmed_at:'2026-11-01T00:00:00Z'};accessStatus=401;refreshStatus=200;readOnly=true;requests=[];writes=[];
 jar=new Map([['icash_access',access(ownerId)],['icash_refresh','fictional-refresh'],[dashboardCookie,issueDashboardProof(access(ownerId),ownerId,secret)]]);
}
const cookies=async()=>({get:name=>jar.has(name)?{value:jar.get(name)}:undefined,set:(name,value)=>{writes.push(name);if(readOnly)throw Error('Cookies can only be modified in a Server Action or Route Handler.');jar.set(name,value);},delete:name=>{writes.push(name);if(readOnly)throw Error('Cookies can only be modified in a Server Action or Route Handler.');jar.delete(name);}});
const db=async()=>{throw Error('Unexpected database write or read');};
const fetch=async(url,options)=>{
 const path=new URL(url).pathname+new URL(url).search;requests.push(path);
 if(path==='/auth/v1/user')return Response.json(identity,{status:accessStatus});
 assert.equal(path,'/auth/v1/token?grant_type=refresh_token');
 assert.deepEqual(JSON.parse(options.body),{refresh_token:'fictional-refresh'});
 return Response.json({access_token:access(identity.id),refresh_token:'fresh-fixture',expires_in:3600,user:identity},{status:refreshStatus});
};
class Redirect extends Error{constructor(destination){super('redirect');this.destination=destination;}}
try{
 const auth=await load('lib/account-auth.ts',{cookies,db,fetch,accountMode:()=> 'live',accessHash:value=>value,phoneSessionCookie:'phone-fixture'});
 const guard=await load('lib/dashboard-password.ts',{cookies,currentUser:auth.currentUser,dashboardCookie,validDashboardProof,workAccount:db});
 const adapter=await load('lib/webinar-account-adapter.ts',{currentUser:auth.currentUser,dashboardCurrentUser:guard.dashboardCurrentUser,db,ownerInboundTarget:{ownerUserId:ownerId},webinarSite:{companyKey:'icash-x',workspacePath:'/'}});
 const page=await load('app/webinar/checkout/preview/page.tsx',{webinarOwnerIdentity:adapter.webinarOwnerIdentity,redirect:destination=>{throw new Redirect(destination);},WebinarExpressCheckout:'checkout',WebinarUpgradePage:'upgrade',_jsx:(type,props)=>({type,props})});
 const render=params=>page.default({searchParams:Promise.resolve(params)});
 const locked=async params=>assert.rejects(render(params),error=>error instanceof Redirect&&error.destination==='/dashboard-unlock?next='+encodeURIComponent('/webinar/checkout/preview'+(params.webinar?'?webinar='+params.webinar+'&variant='+params.variant:'')+(params.vip==='1'?(params.webinar?'&':'?')+'vip=1':'')));
 for(const status of [200,400])for(const variant of ['day','night'])for(const vip of [undefined,'1']){
  reset();refreshStatus=status;
  await locked({webinar:webinarId,variant,vip});
  assert.deepEqual(requests,['/auth/v1/user'],'Rendering never consumes a refresh token');assert.deepEqual(writes,[]);
 }
 reset();jar.delete('icash_access');await locked({});assert.deepEqual(requests,[]);assert.deepEqual(writes,[]);
 for(const variant of ['day','night'])for(const vip of [undefined,'1']){
  reset();accessStatus=200;const result=await render({webinar:webinarId,variant,vip});
  assert.equal(result.type,vip?'upgrade':'checkout');assert.equal(result.props.preview,true);
  assert.equal(result.props.previewBackHref,`/webinar?preview=${webinarId}&variant=${variant}`);assert.deepEqual(writes,[]);
 }
 reset();accessStatus=200;jar.delete(dashboardCookie);await locked({});assert.deepEqual(writes,[]);
 reset();accessStatus=200;identity={...identity,id:'00000000-0000-4000-8000-000000000004'};
 jar.set('icash_access',access(identity.id));jar.set(dashboardCookie,issueDashboardProof(access(identity.id),identity.id,secret));await locked({});assert.deepEqual(writes,[]);
 reset();accessStatus=503;await assert.rejects(render({}),error=>error instanceof auth.AuthRequestError&&error.status===503);assert.deepEqual(writes,[]);
 // Writable API callers retain existing refresh and invalid-session cleanup.
 reset();readOnly=false;assert.equal((await adapter.webinarOwnerIdentity()).id,ownerId);
 assert.equal(requests.length,2);assert(writes.includes('icash_access'));assert.equal(jar.get('icash_refresh'),'fresh-fixture');
 reset();readOnly=false;refreshStatus=400;assert.equal(await adapter.webinarOwnerIdentity(),null);assert(!jar.has('icash_access'));assert(!jar.has('icash_refresh'));
 console.log('PASS preview auth: expired sessions redirect without cookie writes or refresh consumption; Day/Night and VIP destinations, owner proof, errors and writable API refresh remain intact.');
}finally{for(const [key,value] of Object.entries(originalEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
