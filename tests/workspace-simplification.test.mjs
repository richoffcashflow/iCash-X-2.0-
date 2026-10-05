import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as status from '../lib/workspace-status.ts';
import * as progress from '../lib/workspace-progress.ts';
const require=createRequire(import.meta.url);
const code=file=>ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const all=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(all):[root,...all(root.props?.children)];
const text=root=>typeof root==='string'?root:typeof root==='number'?String(root):Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';
const stubs={};function component(name){return stubs[name]??=Object.assign(()=>null,{displayName:name});}
function page(account,campaign,error=false){
 let cursor=0;const slots=[account,error,false,false,'budget_ten',false,'',null,false,campaign];
 const hooks={useState:()=>[slots[cursor++],()=>{}],useRef:value=>({current:value}),useCallback:fn=>fn,useEffect(){}};
 const mod={exports:{}};
 new Function('require','module','exports',code('app/page.tsx'))(name=>name==='react'?hooks:name==='react/jsx-runtime'?require(name):name==='@/lib/workspace-status'?status:name==='@/lib/workspace-progress'?progress:name==='@/lib/bot-setup'?{setupThemes:{ink:{color:'#111',soft:'#eee'}}}:name==='next/image'?{__esModule:true,default:component('Image')}:new Proxy({},{get:(_target,key)=>component(String(key))}),mod,mod.exports);
 return mod.exports.default();
}
const campaign={policy:{version:'v1'},acknowledgment:{version:'v1'},configured:true,released:false,liveWorkReady:false,smsChannelEnabled:true};
const account={signedIn:true,mode:'live',balanceCents:850,assistantName:'Synthetic bot',paused:true,billingActive:false,identity:{principal:'Synthetic company'},smsWorkReady:false,workReady:false};
let tree=page(account,campaign),nodes=all(tree);
assert.equal(nodes.find(n=>n.type===component('BotRunBar')).props.running,false);assert.equal(nodes.find(n=>n.type===component('BotRunBar')).props.balanceCents,850);assert.doesNotMatch(text(tree),/Your account records/);
assert.equal(nodes.filter(n=>n.type==='button'&&n.props.className==='fund-button').length,1,'one primary action');
assert(nodes.some(n=>n.type===component('BotRunBar')&&typeof n.props.onAddCredits==='function'),'one-time credits remain available');
assert.equal(nodes.find(n=>n.props?.['aria-label']==='Workspace settings').props.hidden,true,'settings stay out of the default workspace');
assert(nodes.some(n=>n.type==='button'&&text(n)==='Settings'),'settings have a clear entry point');
assert(nodes.some(n=>n.props?.['aria-label']==='Workspace settings'));
assert(nodes.some(n=>n.type==='details'&&n.props.id==='account-details'),'account details remain accessible');
tree=page({...account,paused:false,billingActive:true,activeWork:true,workReady:true},{...campaign,released:true,liveWorkReady:true},true);
const stop=all(tree).find(n=>n.type===component('BotRunBar'));assert.equal(typeof stop.props.onAddCredits,'function');assert.equal(stop.props.busy,false);
function beneathDetails(root,target,inside=false){if(root===target)return inside;if(Array.isArray(root))return root.some(n=>beneathDetails(n,target,inside));return !!root&&typeof root==='object'&&beneathDetails(root.props?.children,target,inside||root.type==='details');}
assert.equal(beneathDetails(tree,stop),false,'credit action is never hidden in an expander');
tree=page({...account,smsWorkReady:true},{...campaign,released:true},true);assert(all(tree).find(n=>n.type===component('BotRunBar')).props.stale,'stale account state is identified');

function budget(summary){let index=0;const mod={exports:{}};new Function('require','module','exports',code('components/budget-summary.tsx'))(name=>name==='react'?{useEffect(){},useState:()=>[index++===0?summary:'',()=>{}]}:name==='@/lib/workspace-progress'?progress:require(name),mod,mod.exports);return mod.exports.BudgetSummary({onFund(){throw Error('Unexpected funding action');}});}
const summary={spentCents:1750,analyzed:5,reservedCents:0,fundedCents:10000,balanceCents:8250,packs:[],screeningCandidates:3,activeContracts:0,explanation:'Synthetic account totals'};
tree=budget(summary);assert.match(text(tree),/17.50/);assert.match(text(tree),/spent to date/);assert.match(text(tree),/5\s+property analyses completed/);
assert.equal(all(tree).find(n=>n.type==='details').props.open,true,'activity and spending are open');
assert.equal(beneathDetails(tree,all(tree).find(n=>n.props?.['aria-label']==='Recorded work and spending')),true,'settled spend remains accessible under the summary');
tree=budget({...summary,spentCents:undefined});assert.match(text(tree),/Unavailable/);assert.doesNotMatch(text(tree),/\$0.00.*spent/,'missing spend is not fabricated zero');
tree=page({...account,balanceCents:0,smsWorkReady:true},{...campaign,released:true});assert.equal(all(tree).find(n=>n.type===component('BotRunBar')).props.running,false,'zero-balance budget entry stays visible without implying the bot is running');
const source=readFileSync(new URL('../components/live-workspace.tsx',import.meta.url),'utf8');
assert(source.indexOf('<PropertyNextStep property={p}')>source.indexOf('<div className="property-details"'),'detailed next steps moved inside property disclosure');
assert(source.indexOf('className="property-control"')>source.indexOf('<div className="property-details"'),'property controls remain inside opened details');
assert(source.includes('Paused for this property'));assert(source.includes('Owner & contact'));
console.log('PASS simplified workspace: visible credit action, open spending, account recovery, stale status, saved properties and post-payment naming');

tree=page({signedIn:false},null);assert.match(text(tree),/Your properties/);assert(all(tree).some(n=>n.type===component('BotRunBar')));assert.doesNotMatch(text(tree),/Create your AI bot|Name your bot/);assert(!all(tree).some(n=>n.type===component('LiveWorkspace')),'guests never fetch private property data');assert(!all(tree).some(n=>n.type==='button'&&text(n)==='Stop bot'));
tree=page({...account,balanceCents:0,billingModel:'membership_credits',membershipActive:true},campaign);assert(all(tree).some(n=>n.type===component('PostPaymentBotName')),'naming follows paid membership');
tree=page({...account,balanceCents:0,billingModel:'membership_credits',membershipActive:false},campaign);assert(!all(tree).some(n=>n.type===component('PostPaymentBotName')),'unfunded accounts are not asked to name a bot');

assert(all(tree).find(n=>n.type===component('BotRunBar')).props.paymentRequired,'missed membership payment has a recovery action');

const barModule={exports:{}};new Function('require','module','exports',code('components/bot-run-bar.tsx'))(name=>name==='react'?{useState:()=>[null,()=>{}],useEffect(){}}:name==='@/lib/workspace-progress'?progress:require(name),barModule,barModule.exports);
const renderBar=patch=>barModule.exports.BotRunBar({running:false,stopped:false,paymentRequired:false,busy:false,stale:false,balanceCents:0,onAddCredits(){},...patch});
assert.match(text(renderBar({})),/Add credits to continue\. Your leads are saved/);
assert.match(text(renderBar({paymentRequired:true,balanceCents:1000})),/Update payment to resume work\. Your leads are saved/);
assert.match(text(renderBar({running:true,balanceCents:1000})),/Bot running/);
assert.doesNotMatch(text(renderBar({running:true,balanceCents:1000})),/Pause|Stop bot|daily budget/);
