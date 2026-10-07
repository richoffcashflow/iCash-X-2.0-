import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {webinarPurchaseDestination,safeVipSession} from '../lib/webinar-purchase-flow.ts';
import * as vip from '../lib/vip-policy.ts';
import {priceLabel,membershipTermsVersion} from '../lib/membership-policy.ts';

for(const [paid,checkout,upgrade,next] of [[null,false,false,'checkout'],[null,true,false,null],['standard',true,false,'/webinar/upgrade'],['standard',true,true,null],['vip',true,true,'/join?setup=1'],['vip',false,false,'/join?setup=1']])assert.equal(webinarPurchaseDestination(paid,checkout,upgrade),next);
assert.equal(safeVipSession('/live/123456'),'/live/123456');for(const url of ['https://other.test/live/123456','//other.test','javascript:alert(1)','/live/draft'])assert.equal(safeVipSession(url),null);
async function harness(file,extra){const cells=[],effects=[],pending=[];let index=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const deps={useState(initial){const n=index++;if(!(n in cells))cells[n]=typeof initial==='function'?initial():initial;return [cells[n],value=>cells[n]=typeof value==='function'?value(cells[n]):value];},useRef(initial){const n=index++;return cells[n]??={current:initial};},useEffect(fn,list){const n=index++;if(!same(effects[n]?.list,list))pending.push(()=>{effects[n]?.cleanup?.();effects[n]={list,cleanup:fn()};});},_Fragment:'fragment',_jsx:(type,props)=>({type,props}),_jsxs:(type,props)=>({type,props}),Check:'check',ArrowRight:'arrow',ShieldCheck:'shield',...extra};
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
const request=async(url,init={})=>{calls.push({url,init});if(url==='/api/billing/membership')return purchase;if(url==='/api/account?view=core')return {signedIn:true};if(init.method==='POST')return {clientSecret:'secret_fixture',publishableKey:'pk_live_fixture'};return {membership:{accessible:true,vip:verified}};};
const common={...vip,safeVipSession,priceLabel,webinarRequest:request,AccountAccess:'AccountAccess',PostPurchaseSetup:'PostPurchaseSetup',StripeEmbeddedCheckout:'StripeEmbeddedCheckout'};
const props={phase:'watching',email:'casey@example.invalid',customerName:'Casey',needsClaim:true,paidThrough:new Date(Date.now()+86400000).toISOString(),vipSessionUrl:'/live/123456',onRefresh:async()=>({membership:{accessible:true,vip:verified},needsClaim:false}),onWorkspace:()=>redirects.push('/'),onActive:v=>active.push(v)};
const h=await harness('components/webinar-vip-upsell.tsx',common);let current={...props};const render=()=>h.render('WebinarVipUpsell',current);
let tree=render();assert.equal(button(tree,'Upgrade to VIP').props.disabled,true);assert.equal(calls.length,0,'Guest offer never starts payment or email automatically');
button(tree,'Not now').props.onClick();tree=render();assert.match(text(tree),/Keep watching/);assert.equal(redirects.length,0);
current.phase='ended';render();tree=render();assert.ok(button(tree,'Upgrade to VIP'),'The final opportunity returns after the inline decline');button(tree,'No thanks').props.onClick();assert.deepEqual(redirects,['/live/123456']);h.close();
const draft=await harness('components/webinar-vip-upsell.tsx',common);tree=draft.render('WebinarVipUpsell',{...props,phase:'ended',vipSessionUrl:null});button(tree,'No thanks').props.onClick();tree=draft.render('WebinarVipUpsell',{...props,phase:'ended',vipSessionUrl:null});assert.equal(find(tree,'PostPurchaseSetup').props.email,props.email,'No published VIP video falls back to saved setup');draft.close();
const guest=await harness('components/webinar-vip-upsell.tsx',common);tree=guest.render('WebinarVipUpsell',props);find(tree,'input').props.onChange({target:{checked:true}});tree=guest.render('WebinarVipUpsell',props);await button(tree,'Upgrade to VIP').props.onClick();tree=guest.render('WebinarVipUpsell',props);assert.equal(find(tree,'AccountAccess').props.initialEmail,props.email);assert.equal(calls.filter(c=>c.init.method==='POST').length,0,'Verification carries the saved email and cannot charge');guest.close();
const paid=await harness('components/webinar-vip-upsell.tsx',common),paidProps={...props,needsClaim:false};tree=paid.render('WebinarVipUpsell',paidProps);await flush();find(tree,'input').props.onChange({target:{checked:true}});tree=paid.render('WebinarVipUpsell',paidProps);const submit=button(tree,'Upgrade to VIP').props.onClick;await Promise.all([submit(),submit()]);tree=paid.render('WebinarVipUpsell',paidProps);assert.equal(calls.filter(c=>c.init.method==='POST').length,1,'Rapid repeated clicks create one upgrade request');assert.ok(find(tree,'StripeEmbeddedCheckout'));assert.equal(active.at(-1),true);
find(tree,'StripeEmbeddedCheckout').props.onComplete();await flush();tree=paid.render('WebinarVipUpsell',paidProps);assert.match(text(tree),/Confirming your VIP upgrade/);assert.equal(button(tree,'No thanks'),undefined,'A receipt still being verified cannot be skipped or paid again');assert.equal(redirects.length,1);verified=true;await button(tree,'Check upgrade').props.onClick();await flush();paid.close();
// URL flags cannot bypass server verification or trigger a direct VIP video redirect.
const member=await harness('components/membership-checkout.tsx',{...common,membershipTermsVersion,WebinarVipUpsell:'WebinarVipUpsell',webinarBrowserEvent:()=>{}});
window.location.search='?membership=paid&upgrade=paid&setup=1';purchase={offer:{revision:1,priceCents:5000},ready:true,mode:'live',needsClaim:true,email:props.email,customerName:'Casey',postPurchaseUrl:'/live/123456',membership:{accessible:true,vip:false}};
const mp={onSignedIn:()=>{},onPurchased:()=>{}};member.render('MembershipCheckout',mp);await flush();tree=member.render('MembershipCheckout',mp);assert.ok(find(tree,'WebinarVipUpsell'));assert.equal(redirects.length,1,'Verified base purchase shows upsell instead of redirecting to video');purchase.membership.vip=true;await find(tree,'WebinarVipUpsell').props.onRefresh();tree=member.render('MembershipCheckout',mp);assert.ok(find(tree,'PostPurchaseSetup'),'Only verified VIP skips the VIP session');member.close();
console.log('PASS purchase flow: unpaid checkout, two upgrade opportunities, guest continuity, verified VIP setup, draft fallback, payment protection, and no query-string access bypass.');
