import * as finalSale from '../lib/final-sale-policy.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {webinarPurchaseDestination,safeVipSession} from '../lib/webinar-purchase-flow.ts';
import * as exitReminder from '../lib/webinar-exit-reminder.ts';
import * as vip from '../lib/vip-policy.ts';
import {priceLabel,membershipTermsVersion} from '../lib/membership-policy.ts';

for(const [paid,checkout,upgrade,next] of [[null,false,false,'checkout'],[null,true,false,null],['standard',true,false,'/webinar/upgrade'],['standard',true,true,null],['vip',true,true,'/join?setup=1'],['vip',false,false,'/join?setup=1']])assert.equal(webinarPurchaseDestination(paid,checkout,upgrade),next);
assert.equal(safeVipSession('/live/123456'),'/live/123456');for(const url of ['https://other.test/live/123456','//other.test','javascript:alert(1)','/live/draft'])assert.equal(safeVipSession(url),null);
async function harness(file,extra){const cells=[],effects=[],pending=[];let index=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const deps={...finalSale,useState(initial){const n=index++;if(!(n in cells))cells[n]=typeof initial==='function'?initial():initial;return [cells[n],value=>cells[n]=typeof value==='function'?value(cells[n]):value];},useRef(initial){const n=index++;return cells[n]??={current:initial};},useEffect(fn,list){const n=index++;if(!same(effects[n]?.list,list))pending.push(()=>{effects[n]?.cleanup?.();effects[n]={list,cleanup:fn()};});},_Fragment:'fragment',_jsx:(type,props)=>({type,props}),_jsxs:(type,props)=>({type,props}),Check:'check',ArrowRight:'arrow',ShieldCheck:'shield',...extra};
 const key='purchase'+Math.random().toString(36).slice(2);globalThis[key]=deps;
 const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\s*$/gm,'');
 const module=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+code).toString('base64'));
 return {render(name,props){index=0;const node=module[name](props);while(pending.length)pending.shift()();return node;},close(){effects.forEach(e=>e?.cleanup?.());}};
}
const all=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(all)];
const find=(tree,type)=>all(tree).find(n=>n.type===type),text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node?.props?text(node.props.children):'';
const button=(tree,match)=>all(tree).find(n=>n.type==='button'&&text(n).includes(match));
const flush=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
const redirects=[],calls=[],active=[];let verified=false,purchase=null;
globalThis.window={location:{search:'',assign:url=>redirects.push(url),replace:url=>redirects.push(url)}};globalThis.document={hidden:false};
const request=async(url,init={})=>{calls.push({url,init});if(url==='/api/billing/membership')return purchase;if(url==='/api/account?view=core')return {signedIn:true};if(init.method==='POST')return {clientSecret:'secret_fixture',publishableKey:'pk_live_fixture',sessionId:'cs_live_fixture'};return {membership:{accessible:true,vip:verified}};};
const commerceEvents=[];let receiptReads=0;
const common={Script:'Script',webinarBrowserEvent:(...args)=>commerceEvents.push(args),webinarBrowserPurchaseReady:async()=>{receiptReads++;},...exitReminder,WebinarVipWelcome:'WebinarVipWelcome',...vip,safeVipSession,priceLabel,webinarRequest:request,AccountAccess:'AccountAccess',PostPurchaseSetup:'PostPurchaseSetup',StripeEmbeddedCheckout:'StripeEmbeddedCheckout',WebinarPaymentPreview:'WebinarPaymentPreview'};
const props={mode:'live',webinarSessionId:'webinar-fixture',phase:'watching',email:'casey@example.invalid',customerName:'Casey',needsClaim:true,paidThrough:new Date(Date.now()+86400000).toISOString(),vipSessionUrl:'/live/123456',onRefresh:async()=>({membership:{accessible:true,vip:verified},needsClaim:false}),onWorkspace:()=>redirects.push('/'),onActive:v=>active.push(v)};
const h=await harness('components/webinar-vip-upsell.tsx',common);let current={...props};const render=()=>h.render('WebinarVipUpsell',current);
let tree=render();assert.equal(button(tree,'Upgrade to VIP').props.disabled,true);assert.equal(calls.length,0,'Guest offer never starts payment or email automatically');
button(tree,'Not now').props.onClick();tree=render();assert.match(text(tree),/Keep watching/);assert.equal(redirects.length,0);
current.phase='ended';render();tree=render();assert.ok(button(tree,'Upgrade to VIP'),'The final opportunity returns after the inline decline');button(tree,'No thanks').props.onClick();assert.deepEqual(redirects,['/live/123456']);h.close();
const draft=await harness('components/webinar-vip-upsell.tsx',common);tree=draft.render('WebinarVipUpsell',{...props,phase:'ended',vipSessionUrl:null});button(tree,'No thanks').props.onClick();tree=draft.render('WebinarVipUpsell',{...props,phase:'ended',vipSessionUrl:null});assert.equal(find(tree,'PostPurchaseSetup').props.email,props.email,'No published VIP video falls back to saved setup');draft.close();
const guest=await harness('components/webinar-vip-upsell.tsx',common);tree=guest.render('WebinarVipUpsell',props);find(tree,'input').props.onChange({target:{checked:true}});tree=guest.render('WebinarVipUpsell',props);await button(tree,'Upgrade to VIP').props.onClick();tree=guest.render('WebinarVipUpsell',props);assert.equal(find(tree,'AccountAccess').props.initialEmail,props.email);assert.equal(calls.filter(c=>c.init.method==='POST').length,0,'Verification carries the saved email and cannot charge');guest.close();
const paid=await harness('components/webinar-vip-upsell.tsx',common),paidProps={...props,needsClaim:false};tree=paid.render('WebinarVipUpsell',paidProps);await flush();find(tree,'input').props.onChange({target:{checked:true}});tree=paid.render('WebinarVipUpsell',paidProps);const submit=button(tree,'Upgrade to VIP').props.onClick;await Promise.all([submit(),submit()]);tree=paid.render('WebinarVipUpsell',paidProps);assert.equal(calls.filter(c=>c.init.method==='POST').length,1,'Rapid repeated clicks create one upgrade request');assert.ok(find(tree,'StripeEmbeddedCheckout'));assert.equal(active.at(-1),true);
find(tree,'StripeEmbeddedCheckout').props.onComplete();await flush();tree=paid.render('WebinarVipUpsell',paidProps);assert.match(text(tree),/Confirming your VIP upgrade/);assert.equal(button(tree,'No thanks'),undefined,'A receipt still being verified cannot be skipped or paid again');assert.equal(redirects.length,1);verified=true;await button(tree,'Check upgrade').props.onClick();await flush();paid.close();
// URL flags cannot bypass server verification or trigger a direct VIP video redirect.
const member=await harness('components/membership-checkout.tsx',{...common,safeVipSession,membershipTermsVersion,WebinarVipUpsell:'WebinarVipUpsell',webinarBrowserEvent:()=>{}});
window.location.search='?membership=paid&upgrade=paid';purchase={offer:{revision:1,priceCents:5000},ready:true,mode:'live',needsClaim:true,email:props.email,customerName:'Casey',postPurchaseUrl:'/live/123456',membership:{accessible:true,vip:false}};
const mp={onSignedIn:()=>{},onPurchased:()=>{}};member.render('MembershipCheckout',mp);await flush();tree=member.render('MembershipCheckout',mp);assert.ok(find(tree,'WebinarVipUpsell'));assert.equal(redirects.length,1,'Verified base purchase shows upsell instead of redirecting to video');purchase.membership.vip=true;await find(tree,'WebinarVipUpsell').props.onRefresh();tree=member.render('MembershipCheckout',mp);assert.ok(find(tree,'PostPurchaseSetup'),'Only verified VIP skips the VIP session');member.close();
console.log('PASS purchase flow: unpaid checkout, two upgrade opportunities, guest continuity, verified VIP setup, draft fallback, payment protection, and no query-string access bypass.');

// A paid owner remains in the public webinar without a second checkout or automatic welcome.
for(const vipWebinar of [false,true])for(const alreadyVip of [false,true]){
 const reads=[],cart=[],states=[];let opened=0;
 window.location.search='';
 const ownerCheckout=await harness('components/membership-checkout.tsx',{...common,membershipTermsVersion,WebinarVipUpsell:'WebinarVipUpsell',webinarBrowserEvent:(...args)=>cart.push(args),webinarRequest:async(url,init={})=>{
  reads.push({url,init});return {offer:{revision:1,priceCents:5000},ready:true,mode:'live',needsClaim:false,postPurchaseUrl:'/live/123456',membership:{accessible:true,vip:alreadyVip}};
 }});
 const ownerProps={presentation:'webinar',stayOnWebinar:true,vipWebinar,onEngaged:()=>cart.push('engaged'),onSignedIn:()=>opened++,onPurchased:state=>states.push(state)};
 ownerCheckout.render('MembershipCheckout',ownerProps);await flush();const ownerTree=ownerCheckout.render('MembershipCheckout',ownerProps);
 assert.match(text(ownerTree),/You can keep watching/);assert.equal(find(ownerTree,'WebinarVipWelcome'),undefined);assert.equal(find(ownerTree,'WebinarVipUpsell'),undefined);
 assert.equal(find(ownerTree,'StripeEmbeddedCheckout'),undefined);assert.ok(reads.every(r=>!r.init.method),'Existing membership cannot create another payment');
 assert.deepEqual(cart,[],'Reading a paid membership is not cart engagement');assert.deepEqual(states,[alreadyVip?'vip':'standard']);assert.equal(opened,0);
 button(ownerTree,'Open workspace').props.onClick();assert.equal(opened,1,'The explicit workspace button still works');ownerCheckout.close();
}
console.log('PASS owner paid checkout stays in the webinar with an explicit workspace action and no fabricated cart or charge.');

const redirectMember=await harness('components/membership-checkout.tsx',{...common,safeVipSession,membershipTermsVersion,WebinarVipUpsell:'WebinarVipUpsell',webinarBrowserEvent:()=>{}});
purchase.membership.vip=false;purchase.postPurchaseUrl='/live/123456';
const purchaseStates=[],redirectProps={...mp,redirectToVip:true,webinarPhase:'watching',onPurchased:(state,url)=>purchaseStates.push([state,url])};
redirectMember.render('MembershipCheckout',redirectProps);await flush();const beforeRedirect=redirects.length;
let welcomeTree=redirectMember.render('MembershipCheckout',redirectProps);assert.equal(find(welcomeTree,'WebinarVipWelcome').props.href,'/live/123456');assert.equal(find(welcomeTree,'WebinarVipUpsell'),undefined,'The next video is the immediate next step');
assert.deepEqual(purchaseStates,[['standard','/live/123456']]);assert.equal(redirects.length,beforeRedirect,'The confirmation remains visible before the countdown handoff');
welcomeTree=redirectMember.render('MembershipCheckout',{...redirectProps,webinarPhase:'ended'});assert.ok(find(welcomeTree,'WebinarVipWelcome'));redirectMember.close();
console.log('PASS paid handoff: verified Standard access shows the VIP welcome immediately, including before the main video ends.');

for(const scenario of [
 {name:'Pending payment',accessible:false,vip:false,search:'?membership=paid',url:'/live/123456'},
 {name:'Explicit setup after VIP',accessible:true,vip:false,search:'?setup=1',url:'/live/123456',setup:true},
 {name:'Verified VIP member',accessible:true,vip:true,search:'',url:'/live/123456',setup:true},
 {name:'External redirect rejected',accessible:true,vip:false,search:'',url:'https://other.test/live/123456'}
]){
 window.location.search=scenario.search;
 purchase={...purchase,postPurchaseUrl:scenario.url,membership:{accessible:scenario.accessible,vip:scenario.vip}};
 const instance=await harness('components/membership-checkout.tsx',{...common,membershipTermsVersion,WebinarVipUpsell:'WebinarVipUpsell',webinarBrowserEvent:()=>{}});
 const count=redirects.length;
 instance.render('MembershipCheckout',{...mp,redirectToVip:true});await flush();
 const result=instance.render('MembershipCheckout',{...mp,redirectToVip:true});
 assert.equal(redirects.length,count,scenario.name+' does not redirect');
 if(scenario.setup)assert.ok(find(result,'PostPurchaseSetup'),scenario.name+' shows setup');
 instance.close();
}
console.log('PASS pending payment, explicit setup, existing VIP, and unsafe destination guards.');

// Preview uses the real checkout presentation with read-only pricing and no billing call.
const previewCalls=[];
const previewCheckout=await harness('components/membership-checkout.tsx',{...common,membershipTermsVersion,WebinarVipUpsell:'WebinarVipUpsell',webinarBrowserEvent:()=>{throw Error('Preview must not track checkout');},webinarRequest:async(url,init={})=>{previewCalls.push({url,init});assert.equal(url,'/api/webinar/checkout-preview');assert.notEqual(init.method,'POST');return {offer:{revision:4,priceCents:5000,enabled:true,interval:'month'},ready:true,mode:'live',embeddedReady:true,membership:null};}});
window.location.search='?membership=paid&setup=1&session_id=cs_live_fixture';
const previewProps={preview:true,onSignedIn:()=>{},onEngaged:()=>{throw Error('Preview must not engage paid checkout');}};
previewCheckout.render('MembershipCheckout',previewProps);await flush();let previewTree=previewCheckout.render('MembershipCheckout',previewProps);
assert.match(text(previewTree),/\$50/);assert.match(text(previewTree),/Try checkout without a charge/);
find(previewTree,'input').props.onChange({target:{checked:true}});previewTree=previewCheckout.render('MembershipCheckout',previewProps);
await button(previewTree,'Get software access').props.onClick();previewTree=previewCheckout.render('MembershipCheckout',previewProps);
assert.ok(find(previewTree,'WebinarPaymentPreview'));assert.equal(find(previewTree,'WebinarPaymentPreview').props.priceCents,5000);
assert.equal(previewCalls.length,1,'Clicking preview purchase never creates a payment or fetches owner billing');
assert.equal(find(previewTree,'StripeEmbeddedCheckout'),undefined);
previewCheckout.close();
console.log('PASS owner checkout preview: current price, real layout, paid URL flags ignored, no payment or conversion side effects.');

// Webinar and post-webinar offers open payment automatically, once, without consent fabrication.
for(const savedEmail of [false,true])for(const isPreview of [false,true])for(const display of [{presentation:'webinar'},{presentation:'plan',autoOpen:true}]){
 const events=[];window.location.search='';
 const h=await harness('components/membership-checkout.tsx',{...common,membershipTermsVersion,WebinarVipUpsell:'WebinarVipUpsell',webinarBrowserEvent:()=>{throw Error('Automatic display must not track purchase intent');},webinarRequest:async(url,init={})=>{
  events.push({url,init});
  if(init.method==='POST')return {clientSecret:'fixture',publishableKey:'pk_test_fixture',sessionId:'cs_fixture'};
  return {offer:{revision:9,priceCents:5000},ready:true,mode:'test',email:savedEmail?'fixture@example.invalid':null,embeddedReady:true,membership:null};
 }});
 const props={preview:isPreview,...display,embedded:true,onSignedIn:()=>{},onEngaged:()=>{throw Error('Automatic display is not engagement');}};
 const loading=h.render('MembershipCheckout',props);
 assert.equal(find(loading,'Script')?.props.src,isPreview||!display.autoOpen?undefined:'https://js.stripe.com/endive/stripe.js','Only real automatic checkout warms Stripe while membership loads');
 assert.equal(events.some(e=>e.init.method==='POST'),false,'Payment preparation still waits for the current offer');
 await flush();h.render('MembershipCheckout',props);await flush();let tree=h.render('MembershipCheckout',props);
 assert.equal(button(tree,'Buy now'),undefined);assert.equal(button(tree,'Get my AI bot'),undefined);
 h.render('MembershipCheckout',props);await flush();
 if(!isPreview&&!savedEmail){assert.equal(events.filter(e=>e.init.method==='POST').length,0,'No checkout before checking the payment email');find(tree,'input').props.onChange({target:{value:'fixture@example.invalid'}});tree=h.render('MembershipCheckout',props);find(tree,'form').props.onSubmit({preventDefault(){}});await flush();tree=h.render('MembershipCheckout',props);}
 const writes=events.filter(e=>e.init.method==='POST');assert.equal(writes.length,isPreview?0:1);
 if(!isPreview){const body=JSON.parse(writes[0].init.body);assert.equal(body.email,'fixture@example.invalid');assert.equal(body.action,'prepare');assert.equal(body.accepted,undefined);assert.equal(body.embedded,true);assert.equal(body.revision,9);assert.equal(body.totalCents,5000);assert.ok(find(tree,'StripeEmbeddedCheckout'));}
 else {assert.ok(find(tree,'WebinarPaymentPreview'));assert.equal(find(tree,'WebinarPaymentPreview').props.onBack,undefined);}
 h.close();
}
console.log('PASS direct checkout: opens once, no intermediate buy button, no fabricated acceptance, and preview makes no purchases.');

// Owner walkthrough shows only fixed sample fields and never accepts payment data.
{
 let completed=0,back=0;
 const h=await harness('components/webinar-payment-preview.tsx',{priceLabel,ArrowLeft:'ArrowLeft',LockKeyhole:'LockKeyhole'});
 const props={priceCents:5000,onBack:()=>back++,onComplete:()=>completed++};
 let tree=h.render('WebinarPaymentPreview',props);
 assert.equal(all(tree).filter(n=>n.type==='input').length,7);
 assert.ok(all(tree).filter(n=>n.type==='input').every(n=>n.props.readOnly));
 assert.match(text(tree),/Sample details/);button(tree,'Preview payment').props.onClick();
 tree=h.render('WebinarPaymentPreview',props);assert.equal(completed,1);assert.match(text(tree),/No payment was taken/);
 button(tree,'Back to offer').props.onClick();assert.equal(back,1);h.close();
}
console.log('PASS owner payment walkthrough: sample-only fields, local completion and return to offer.');

// VIP checkout never treats Standard access as a completed upgrade or loops to the video.
for(const state of [null,'standard','vip'])for(const active of [false,true]){
 assert.equal(webinarPurchaseDestination(state,true,active,true),state==='vip'?'/':active?null:'/webinar/upgrade');
}
for(const accessible of [false,true]){
 const events=[],paidStates=[],engagement=[];window.location.search='?setup=1&upgrade=paid';
 let verifiedVip=false;
 const instance=await harness('components/membership-checkout.tsx',{...common,membershipTermsVersion,WebinarVipUpsell:'WebinarVipUpsell',webinarBrowserEvent:()=>{},webinarRequest:async(url,init={})=>{
  events.push({url,init});assert.notEqual(init.method,'POST','A VIP viewer never starts another base subscription');
  return {offer:{revision:1,priceCents:5000},ready:true,mode:'live',needsClaim:false,email:'saved@example.invalid',customerName:'Casey',postPurchaseUrl:'/live/123456',membership:{accessible,vip:verifiedVip}};
 }});
 const props={vipWebinar:true,redirectToVip:true,presentation:'webinar',webinarPhase:'ended',onSignedIn:()=>{},onPurchased:state=>paidStates.push(state),onEngaged:()=>engagement.push(true)};
 const before=redirects.length;instance.render('MembershipCheckout',props);await flush();let tree=instance.render('MembershipCheckout',props);
 assert.equal(redirects.length,before,'Upgrade offer never redirects back into the VIP video');
 if(accessible){
  assert.ok(find(tree,'WebinarVipUpsell'));assert.equal(find(tree,'WebinarVipUpsell').props.email,'saved@example.invalid');assert.equal(find(tree,'WebinarVipUpsell').props.vipSessionUrl,null);
  assert.deepEqual(paidStates,['standard']);assert.equal(engagement.length,0,'Reading Standard access is not upgrade engagement');
  verifiedVip=true;await find(tree,'WebinarVipUpsell').props.onRefresh();tree=instance.render('MembershipCheckout',props);
  assert.equal(paidStates.at(-1),'vip');assert.match(text(tree),/VIP upgrade confirmed/);assert.equal(find(tree,'PostPurchaseSetup'),undefined);
 }else{assert.match(text(tree),/Restore your existing subscription/);assert.equal(find(tree,'StripeEmbeddedCheckout'),undefined);}
 instance.close();
}
{
 const states=[],instance=await harness('components/membership-checkout.tsx',{...common,membershipTermsVersion,WebinarVipUpsell:'WebinarVipUpsell',webinarBrowserEvent:()=>{},webinarRequest:async(url,init={})=>{
  assert.equal(url,'/api/webinar/checkout-preview');assert.notEqual(init.method,'POST');return {offer:{revision:1,priceCents:5000},ready:true,membership:null};
 }});
 const props={preview:true,vipWebinar:true,presentation:'webinar',onSignedIn:()=>{},onPurchased:state=>states.push(state)};
 instance.render('MembershipCheckout',props);await flush();const tree=instance.render('MembershipCheckout',props),payment=find(tree,'WebinarPaymentPreview');
 assert.equal(payment.props.vipUpgrade,true);assert.equal(payment.props.priceCents,vip.vipUpgradeCents);payment.props.onComplete();assert.deepEqual(states,['vip']);instance.close();
}
console.log('PASS VIP offer: saved buyer details, verified upgrade state, no repeat subscription, no video loop, safe preview pricing.');

// The final offer page receives verified states from checkout and routes only VIP buyers.
for(const preview of [false,true]){
 const instance=await harness('components/webinar-upgrade-page.tsx',{IcashMark:'IcashMark',MembershipCheckout:'MembershipCheckout'});
 const before=redirects.length,tree=instance.render('WebinarUpgradePage',{preview});
 const checkout=find(tree,'MembershipCheckout');
 assert.equal(checkout.props.vipWebinar,true);assert.equal(checkout.props.preview,preview);
 checkout.props.onPurchased('standard');assert.equal(redirects.length,before);
 checkout.props.onPurchased('vip');assert.equal(redirects.length,preview?before:before+1);
 if(!preview)assert.equal(redirects.at(-1),'/');
 instance.close();
}
console.log('PASS final VIP offer: verified upgrades open the workspace; Standard and preview states stay in the offer.');

// The welcome gives five visible seconds, allows immediate continuation, and never charges.
{
 let tick,cleared=0;
 const exitHandlers=new Set(),exitStorage=new Map();
 window.addEventListener=(name,fn)=>{assert.equal(name,'beforeunload');exitHandlers.add(fn);};window.removeEventListener=(_name,fn)=>exitHandlers.delete(fn);
 globalThis.sessionStorage={getItem:key=>exitStorage.get(key)??null,setItem:(key,value)=>exitStorage.set(key,value)};
 const h=await harness('components/webinar-vip-welcome.tsx',{...exitReminder,safeVipSession,setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>cleared++});
 const props={href:'/live/123456',fullScreen:true},before=redirects.length;
 let tree=h.render('WebinarVipWelcome',props);assert.match(text(tree),/Don’t leave yet/);assert.match(text(tree),/Stay here to watch your VIP webinar/);
 assert.equal(exitHandlers.size,1,'Payment confirmation arms one real-exit reminder');
 assert.equal(button(tree,'Watch VIP now').props.disabled,undefined);
 document.hidden=true;for(let i=0;i<10;i++)tick();assert.equal(redirects.length,before);document.hidden=false;
 for(let i=0;i<4;i++)tick();assert.equal(redirects.length,before);tick();assert.equal(redirects.length,before+1);assert.equal(redirects.at(-1),props.href);
 assert.equal(exitHandlers.size,0,'Automatic VIP continuation never prompts');assert.equal(exitStorage.size,0);
 button(tree,'Watch VIP now').props.onClick();tick();assert.equal(redirects.length,before+1,'Only one navigation per handoff');h.close();assert.ok(cleared>0);
 const direct=await harness('components/webinar-vip-welcome.tsx',{...exitReminder,safeVipSession,setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{}});
 tree=direct.render('WebinarVipWelcome',props);button(tree,'Watch VIP now').props.onClick();assert.equal(redirects.length,before+2);direct.close();
 assert.equal(exitHandlers.size,0,'Watch VIP now also bypasses the reminder');
 // An automatically prepared embedded checkout can fall back to hosted Stripe.
 // This intended navigation must bypass the regular-room guard as well.
 window.location.search='';
 const hosted=await harness('components/membership-checkout.tsx',{...common,membershipTermsVersion,WebinarVipUpsell:'WebinarVipUpsell',webinarBrowserEvent:()=>{},webinarRequest:async(_url,init={})=>init.method==='POST'?{url:'https://checkout.stripe.com/fixture'}:{offer:{revision:1,priceCents:5000},ready:true,mode:'test',email:'fixture@example.invalid',embeddedReady:true,membership:null}});
 exitReminder.installWebinarExitReminder();assert.equal(exitHandlers.size,1);
 const hostedProps={presentation:'webinar',embedded:true,onSignedIn:()=>{},onEngaged:()=>{throw Error('Preparation is not payment engagement');}};
 hosted.render('MembershipCheckout',hostedProps);await flush();hosted.render('MembershipCheckout',hostedProps);await flush();hosted.render('MembershipCheckout',hostedProps);
 assert.equal(redirects.at(-1),'https://checkout.stripe.com/fixture');assert.equal(exitHandlers.size,0);assert.equal(exitStorage.size,0);hosted.close();
 const unsafe=await harness('components/webinar-vip-welcome.tsx',{...exitReminder,safeVipSession,setInterval:()=>{throw Error('Unsafe destinations must not start timers');},clearInterval:()=>{}});
 assert.equal(unsafe.render('WebinarVipWelcome',{href:'https://other.test/live/123456'}),null);unsafe.close();
}
console.log('PASS VIP welcome: clear stay message, immediate button, five visible seconds, cleanup, no duplicate navigation or unsafe URLs.');

// Commerce events follow real checkout states, including the automatic embedded path.
window.location.search='';
for(const mode of ['live','test']){
 const events=[];let settled=false,converted=0,releaseReceipt;
 const receiptGate=new Promise(resolve=>{releaseReceipt=resolve;});
 const status={offer:{revision:1,priceCents:5000},ready:true,mode,email:'fixture@example.invalid',embeddedReady:true,needsClaim:false,membership:null};
 const fixture=await harness('components/membership-checkout.tsx',{...common,membershipTermsVersion,WebinarVipUpsell:'WebinarVipUpsell',
  webinarBrowserEvent:(...args)=>events.push(args),webinarBrowserPurchaseReady:()=>receiptGate,
  webinarRequest:async(_url,init={})=>init.method==='POST'?{clientSecret:'secret',publishableKey:'pk_'+mode+'_fixture',sessionId:'cs_'+mode+'_fixture'}:{...status,membership:settled?{accessible:true,vip:false}:null}
 });
 const input={autoOpen:true,embedded:true,webinarSessionId:'webinar-fixture',onSignedIn:()=>{},onPurchased:()=>{converted++;}};
 fixture.render('MembershipCheckout',input);await flush();fixture.render('MembershipCheckout',input);await flush();
 let current=fixture.render('MembershipCheckout',input);const embedded=find(current,'StripeEmbeddedCheckout');assert(embedded);
 assert.equal(events.length,0,'Preparing a form does not fabricate a cart or mounted checkout');
 embedded.props.onReady();current.props.onFocusCapture();current.props.onFocusCapture();
 assert.deepEqual(events.map(e=>e[0]),mode==='live'?['checkout_started','add_to_cart']:[]);
 if(mode==='live'){assert.equal(events[0][1],'webinar-fixture');assert.equal(events[0][2].checkoutId,'cs_live_fixture');assert.equal(events[0][2].valueCents,5000);}
 embedded.props.onComplete();await flush();assert.equal(converted,0,'Completion alone is not verified paid access');
 settled=true;current=fixture.render('MembershipCheckout',input);button(current,'Check payment').props.onClick();await flush();
 if(mode==='live')assert.equal(converted,0,'Receipt measurement has a chance to queue before the paid redirect');
 releaseReceipt();await flush();assert.equal(converted,1);fixture.close();
}
// VIP selection and mounted checkout use the additional $50, not the $100 renewal.
{
 const events=[],fixture=await harness('components/webinar-vip-upsell.tsx',{...common,webinarBrowserEvent:(...args)=>events.push(args)}),input={...props,needsClaim:false};
 verified=false;let current=fixture.render('WebinarVipUpsell',input);await flush();
 find(current,'input').props.onChange({target:{checked:true}});current=fixture.render('WebinarVipUpsell',input);
 assert.equal(events.length,0);button(current,'Upgrade to VIP').props.onClick();await flush();current=fixture.render('WebinarVipUpsell',input);
 find(current,'StripeEmbeddedCheckout').props.onReady();
 assert.deepEqual(events.map(e=>e[0]),['add_to_cart','checkout_started']);assert(events.every(e=>e[2].product==='vip_upgrade'&&e[2].valueCents===5000));fixture.close();
}
console.log('PASS real commerce paths: Standard auto-embed, VIP selected/mounted, $50 amounts, live-only stages, no premature paid callback and receipt-before-navigation.');
