import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {identityNames,chooseAccountVoice} from '../lib/customer-identity.ts';
import {normalizeUpdatePhone} from '../lib/customer-updates.ts';
import {normalizeEmail} from '../lib/funding-policy.ts';
const require=createRequire(import.meta.url);
const compile=file=>ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function load(file,mocks){const mod={exports:{}};new Function('require','module','exports',compile(file))(name=>mocks[name]??require(name),mod,mod.exports);return mod.exports;}
const uid='00000000-0000-4000-8000-000000000001',aid='00000000-0000-4000-8000-000000000002';
let user={id:uid,email:'owner@example.com',email_confirmed_at:'2026-01-01'},origin=true,limited=false,authFail=false,calls=[];
const mocks={
 'next/headers':{cookies:async()=>({get:()=>({value:'USER_ACCESS'})})},
 'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})}},
 '@/lib/account-auth':{currentUser:async()=>user,authRequest:async(...args)=>{calls.push({auth:args});if(authFail)throw Error('PROVIDER_SECRET');return {id:uid,email:user.email,new_email:args[1].email};}},
 '@/lib/funding-policy':{normalizeEmail,allowedOrigin:()=>origin},
 '@/lib/funding':{validGuest:()=>false,limitRequest:async(...args)=>{calls.push({rate:args.slice(1)});if(limited)throw Error('rate');}},
 '@/lib/stripe-test':{guestHash:x=>x,db:async(path,method,body)=>{calls.push({path,method,body});if(path.startsWith('icash_accounts?')){assert(path.includes('owner_user_id=eq.'+uid));return [{id:aid}];}if(path.startsWith('icash_customer_identities?'))return [{voice_id:'persisted',voice_name:'Chris'}];if(path.startsWith('icash_bot_setups?'))return [];if(path.startsWith('rpc/'))return {identity:{principal:body.p_company||body.p_first+' '+body.p_last},phone:body.p_phone,smsUpdatesPaused:false};throw Error('Unexpected DB');}},
 '@/lib/checkout-customer-context':{checkoutCustomerContext:async()=>({})},'@/lib/setup-voices':{setupVoices:async()=>[]},'@/lib/elevenlabs':{elevenRequest:async()=>{throw Error('Do not assign a new voice');}},
 '@/lib/customer-identity':{identityNames,chooseAccountVoice},'@/lib/customer-updates':{normalizeUpdatePhone}
};
const route=load('app/api/account/identity/route.ts',mocks),emailRoute=load('app/api/account/email/route.ts',mocks);
const post=(route,body)=>route.POST(new Request('https://example.com/api/account',{method:'POST',body:JSON.stringify(body)}));
const person={first_name:'Taylor',last_name:'Reed',company_name:'',phone:'(212) 555-0123'};
origin=false;assert.equal((await post(route,person)).status,403);assert.equal(calls.length,0);origin=true;
user=null;assert.equal((await post(route,person)).status,401);assert.equal(calls.length,0);user={id:uid,email:'owner@example.com',email_confirmed_at:'2026-01-01'};
for(const bad of [{...person,phone:'x'},{...person,last_name:''},{...person,account_id:aid},{...person,phone:null}])assert.equal((await post(route,bad)).status,400);
assert.equal(calls.length,0);
let result=await post(route,person);assert.equal(result.status,200);assert.equal(result.body.phone,'+12125550123');assert.equal(calls.at(-1).path,'rpc/icash_save_account_details');assert.equal(calls.at(-1).body.p_user,uid);
result=await post(route,{first_name:'',last_name:'',company_name:'Oak Homes',phone:''});assert.equal(result.status,200);assert.equal(calls.at(-1).body.p_phone,'');
result=await post(route,{first_name:'New',last_name:'Buyer',company_name:''});assert.equal(result.status,200);assert.equal(calls.at(-1).path,'rpc/icash_save_customer_identity','onboarding retains its name-only flow');
calls=[];process.env.ICASH_AUTH_EMAIL_READY='true';process.env.ICASH_APP_ORIGIN='https://example.com';
origin=false;assert.equal((await post(emailRoute,{email:'next@example.com'})).status,403);origin=true;
for(const body of [{email:'x'},{email:'next@example.com',userId:aid}])assert.equal((await post(emailRoute,body)).status,400);
assert.equal(calls.length,0);
result=await post(emailRoute,{email:' NEXT@example.com '});assert.equal(result.status,200);assert.equal(result.body.email,'owner@example.com','unconfirmed email never replaces login identity');assert.equal(result.body.pendingEmail,'next@example.com');
const auth=calls.find(c=>c.auth).auth;assert.equal(auth[3],'PUT');assert.equal(auth[2],'USER_ACCESS');assert.deepEqual(auth[1],{email:'next@example.com'});assert.equal(auth[0],'user?redirect_to=https%3A%2F%2Fexample.com%2F%3Fsettings%3Daccount');
limited=true;calls=[];assert.equal((await post(emailRoute,{email:'next@example.com'})).status,429);assert(!calls.some(c=>c.auth));limited=false;
authFail=true;assert.equal((await post(emailRoute,{email:'next@example.com'})).status,503);authFail=false;
calls=[];assert.equal((await post(emailRoute,{email:user.email})).status,200);assert.equal(calls.length,0,'unchanged email sends no message');
// The shared auth client must preserve existing GET/POST calls and use PUT only on explicit request.
let request;
process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_SECRET_KEY='SYNTHETIC';
const originalFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{request={url,...options};return Response.json({id:uid});};
const authService=load('lib/account-auth.ts',{'next/headers':mocks['next/headers'],'@/lib/stripe-test':mocks['@/lib/stripe-test'],'@/lib/account-mode':{accountMode:()=>null}});
await authService.authRequest('user',undefined,'USER_ACCESS');assert.equal(request.method,'GET');await authService.authRequest('otp',{email:user.email});assert.equal(request.method,'POST');await authService.authRequest('user',{email:'next@example.com'},'USER_ACCESS','PUT');assert.equal(request.method,'PUT');assert.equal(request.headers.Authorization,'Bearer USER_ACCESS');
globalThis.fetch=originalFetch;
console.log('PASS editable account API: authenticated owner scope, normalized/cleared phone, individual/company validation, preserved voice, explicit user-token email confirmation, CSRF and rate limits.');

const all=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(all):[root,...all(root.props?.children)];const text=root=>typeof root==='string'?root:Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';
let slots=[],cursor=0,dirty=true,pending=[],tree,posts=[],saved=0,failEmail=false;
const props={identity:{first_name:'',last_name:'',company_name:'Oak Homes',principal:'Oak Homes'},contact:{email:'owner@example.com',phone:'+12125550123'},onSaved(){saved++;}};
const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((v,n)=>!Object.is(v,prior.deps[n]))){slots[i]={deps};pending.push(fn);}}};
const ui=load('components/customer-identity.tsx',{'react':hooks});
function render(){cursor=0;dirty=false;tree=ui.CustomerIdentity(props);}
async function flush(){for(let i=0;i<30;i++){if(dirty)render();const tasks=pending;pending=[];tasks.forEach(fn=>fn());await new Promise(r=>setTimeout(r,1));if(!dirty&&!pending.length)return;}throw Error('UI did not settle');}
globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);posts.push({url,body});if(url.endsWith('/email'))return failEmail?Response.json({error:'Email service unavailable'},{status:503}):Response.json({email:props.contact.email,pendingEmail:body.email});return Response.json({identity:{},phone:body.phone,smsUpdatesPaused:false});};
const field=label=>{const row=all(tree).find(n=>n.type==='label'&&text(n).trim()===label);assert(row,'Missing '+label);return all(row).find(n=>n.type==='input');};
await flush();assert.equal(field('Email').props.value,'owner@example.com');assert.equal(field('Phone').props.value,'+12125550123');assert(field('Company name'));assert(!text(tree).includes('Outreach channels'));
all(tree).find(n=>n.type==='input'&&n.props.type==='radio'&&!n.props.checked).props.onChange();await flush();assert(field('First name'));assert(field('Last name'));field('First name').props.onChange({target:{value:'Taylor'}});field('Last name').props.onChange({target:{value:'Reed'}});field('Email').props.onChange({target:{value:'new@example.com'}});await flush();
const save=tree.props.onSubmit;const attempt=save({preventDefault(){}});save({preventDefault(){}});await attempt;await flush();assert.equal(posts.length,2,'duplicate save does not duplicate provider requests');assert.deepEqual(posts[0].body,{first_name:'Taylor',last_name:'Reed',company_name:'',phone:'+12125550123'});assert.equal(posts[1].url,'/api/account/email');assert.equal(saved,1);assert.match(text(tree),/Confirm\s+new@example.com/);assert.match(text(tree),/keep signing in with\s+owner@example.com/);
failEmail=true;field('Email').props.onChange({target:{value:'retry@example.com'}});await flush();await tree.props.onSubmit({preventDefault(){}});await flush();assert.match(text(tree),/Email service unavailable/);assert.equal(saved,2,'partial save refreshes durable name and phone');
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');assert.match(page,/<OutreachCampaignAcknowledgment statusOnly/);assert(!page.includes('className="account-email"'));
globalThis.fetch=originalFetch;
console.log('PASS account form: email/phone editable, individual first/last fields, single save, duplicate protection, pending-email truthfulness and partial-failure recovery.');
