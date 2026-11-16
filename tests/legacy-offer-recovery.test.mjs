import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {jsx,jsxs} from 'react/jsx-runtime';
import {legacyTrialVersion,legacyTrialTerms} from '../lib/legacy-trial-policy.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

// Execute the actual page handlers with deterministic hook scheduling and no network.
let slots=[],cursor=0,effects=[],mounted=false;
const listeners=new Map(),requests=[],navigations=[];
const original={window:globalThis.window,fetch:globalThis.fetch};
const AccountAccess=()=>null;
const deps={jsx,jsxs,AccountAccess,legacyTrialVersion,legacyTrialTerms,
 useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
 useRef:initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
 useEffect:fn=>{if(!mounted)effects.push(fn);}};
let settle;
globalThis.window={location:{search:'',assign:url=>navigations.push(url)},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
globalThis.fetch=(url,options)=>{requests.push({url,options});return new Promise(resolve=>{settle=resolve;});};
let code=ts.transpileModule(readFileSync(new URL('../app/legacy-offer/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\s*$/gm,'');
// Automatic JSX transform aliases are local compiler names.
globalThis.__offerRecovery={...deps,_jsx:jsx,_jsxs:jsxs};
const {default:Page}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(globalThis.__offerRecovery).join(',')+'}=globalThis.__offerRecovery;\n'+code).toString('base64'));
const render=()=>{cursor=0;const tree=Page();mounted=true;return tree;};
const all=node=>Array.isArray(node)?node.flatMap(all):node&&typeof node==='object'?[node,...all(node.props?.children)]:[];
const find=(tree,test)=>all(tree).find(test);
const form=tree=>find(tree,x=>x.type==='form');
const toggle=tree=>find(tree,x=>x.type==='button'&&x.props.children==='Resume a checkout from another device');
const event={preventDefault(){}};
let cleanups=[];
try{
 let tree=render();cleanups=effects.map(f=>f());
 find(tree,x=>x.type==='input'&&x.props.type==='email').props.onChange({target:{value:'fixture@example.invalid'}});
 find(tree,x=>x.type==='input'&&x.props.type==='checkbox').props.onChange({target:{checked:true}});
 tree=render();
 // Same-render rapid clicks must share the pending request.
 const first=form(tree).props.onSubmit(event);await form(tree).props.onSubmit(event);
 assert.equal(requests.length,1);assert.deepEqual(JSON.parse(requests[0].options.body),{email:'fixture@example.invalid',accepted:true,version:legacyTrialVersion});
 assert.equal(toggle(render()).props.disabled,true);
 settle(Response.json({error:'Checkout unavailable',recover:true},{status:409}));await first;
 tree=render();assert(!find(tree,x=>x.type===AccountAccess),'Even an older server recover flag cannot force a no-checkout user into OTP');
 assert.equal(toggle(tree).props.disabled,false);assert.equal(find(tree,x=>x.props.role==='alert').props.children,'Checkout unavailable');
 // Recovery remains user-selected and successful verification does not buy anything.
 toggle(tree).props.onClick();tree=render();const recovery=find(tree,x=>x.type===AccountAccess);
 assert.equal(recovery.props.initialEmail,'fixture@example.invalid');assert.equal(recovery.props.trialRecovery,true);
 recovery.props.onSignedIn();tree=render();assert.equal(requests.length,1);assert(!find(tree,x=>x.type===AccountAccess));
 const retry=form(tree).props.onSubmit(event);settle(Response.json({url:'https://checkout.stripe.com/original'}));await retry;
 assert.deepEqual(navigations,['https://checkout.stripe.com/original']);
 assert.equal(find(render(),x=>x.type==='button'&&x.props.className==='returning-primary').props.disabled,true);
 listeners.get('pageshow')({persisted:false});await form(render()).props.onSubmit(event);assert.equal(requests.length,2);
 listeners.get('pageshow')({persisted:true});tree=render();assert.equal(find(tree,x=>x.type==='button'&&x.props.className==='returning-primary').props.disabled,false);
 const back=form(tree).props.onSubmit(event);assert.equal(requests.length,3);assert.deepEqual(requests[2].options,requests[1].options);
 settle(Response.json({error:'Still unavailable',recover:false},{status:409}));await back;
 // A fresh navigation retains a usable form without automatically sending a request.
 slots=[];mounted=false;effects=[];tree=render();assert.equal(requests.length,3);assert(!find(tree,x=>x.type===AccountAccess));
}finally{for(const cleanup of cleanups)cleanup?.();Object.assign(globalThis,original);delete globalThis.__offerRecovery;}
assert.equal(listeners.size,0);

// Unknown email and eligible recovery retain identical public responses. Only the
// existing server eligibility decision permits an OTP; no customer/provider calls.
process.env.ICASH_AUTH_EMAIL_READY='true';let eligible=false,otp=0;
const auth=await loadService('app/api/auth/email/route.ts',{accountMode:()=> 'live',NextResponse:{json:Response.json},allowedOrigin:()=>true,normalizeEmail:x=>x,limitRequest:async()=>{},db:async(path)=>{assert.equal(path,'rpc/icash_can_sign_in');return eligible;},authRequest:async()=>{otp++;}});
const request=()=>new Request('https://example.invalid/api/auth/email',{method:'POST',body:JSON.stringify({email:'fixture@example.invalid'})});
const unknown=await (await auth.POST(request())).json();assert.equal(otp,0);eligible=true;
assert.deepEqual(await (await auth.POST(request())).json(),unknown);assert.equal(otp,1);
console.log('PASS introductory recovery: no forced OTP, explicit eligible recovery, rapid clicks, Stripe return/navigation, private eligibility and no live requests.');
