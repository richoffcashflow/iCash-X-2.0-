import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as policy from '../components/outreach-campaign-state.ts';
const require = createRequire(import.meta.url);
const fixture = {policy:{version:'fixture-v1',text:'Synthetic campaign responsibilities.',mode:'outreach_channels'},mode:'sms_inbound',principal:'Fixture business',acknowledgment:null,configured:false,released:false,liveWorkReady:false};
let state = policy.initialOutreachCampaignState;
assert.equal(state.checked,false);assert.equal(policy.canSaveCampaign(state),false);
state=policy.outreachCampaignReducer(state,{type:'loaded',status:fixture});
assert.equal(policy.canSaveCampaign(state),false);
state=policy.outreachCampaignReducer(state,{type:'checked',checked:true});assert.equal(policy.canSaveCampaign(state),true);
state=policy.outreachCampaignReducer(state,{type:'saving'});assert.equal(state.checked,false);assert.equal(policy.canSaveCampaign(state),false);
state=policy.outreachCampaignReducer(state,{type:'error',error:'Offline'});assert.equal(policy.canSaveCampaign(state),false);
state=policy.outreachCampaignReducer(state,{type:'loaded',status:{...fixture,policy:{...fixture.policy,version:'fixture-v2'}}});assert.equal(state.checked,false);
assert.equal(policy.hasCurrentCampaignAcknowledgment({...fixture,acknowledgment:{version:'old',acceptedAt:'2026-09-30T12:00:00Z'}}),false);
assert.throws(()=>policy.parseCampaignStatus({...fixture,configured:'true'}));assert.throws(()=>policy.parseCampaignStatus({...fixture,acknowledgment:{version:'fixture-v1',acceptedAt:'invalid'}}));
const code=ts.transpileModule(readFileSync(new URL('../components/outreach-campaign-acknowledgment.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(){
 let slots=[],cursor=0,effect,cleanup,calls=[],statuses=[];
 const hooks={useReducer(reducer,initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],event=>{slots[i]=reducer(slots[i],event);}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn){effect??=fn;}};
 const mod={exports:{}};
 new Function('require','module','exports',code)(name=>name==='react'?hooks:name==='./outreach-campaign-state'?policy:require(name),mod,mod.exports);
 let responder=()=>Promise.resolve(new Response(JSON.stringify(fixture),{status:200}));
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return responder(url,options);};
 return{calls,statuses,render(){cursor=0;return mod.exports.OutreachCampaignAcknowledgment({onStatus:value=>statuses.push(value)});},mount(){cleanup=effect();},unmount(){cleanup?.();},respond(fn){responder=fn;},state(){return slots[0];}};
}
function elements(root){return !root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(elements):[root,...elements(root.props?.children)];}
function find(root,predicate){const item=elements(root).find(predicate);assert.ok(item,'expected rendered control');return item;}
function text(root){return typeof root==='string'?root:Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const h=harness();let tree=h.render();assert.match(text(tree),/Checking saved campaign status/);h.mount();await tick();tree=h.render();assert.equal(h.statuses.at(-1).configured,false,'parent receives verified status');
const collapsed=find(tree,node=>node.type==='details');assert.equal(collapsed.props.open,undefined,'campaign details start collapsed');assert.ok(find(collapsed,node=>node.type==='summary'));assert.ok(find(collapsed,node=>node.props?.id==='outreach-campaign-policy'));assert.ok(find(collapsed,node=>node.type==='input'&&node.props.type==='checkbox'),'acceptance requires opening full policy');
let checkbox=find(tree,node=>node.type==='input'&&node.props.type==='checkbox');assert.equal(checkbox.props.checked,false);assert.equal(checkbox.props.type,'checkbox');assert.equal(checkbox.props.disabled,false);
assert.ok(find(tree,node=>node.type==='label'&&node.props.htmlFor===checkbox.props.id));assert.ok(checkbox.props['aria-describedby']);
let button=find(tree,node=>node.type==='button'&&text(node)==='Save outreach channels');assert.equal(button.props.type,'button');assert.equal(button.props.disabled,true);
checkbox.props.onChange({target:{checked:true}});tree=h.render();button=find(tree,node=>node.type==='button'&&text(node)==='Save outreach channels');assert.equal(button.props.disabled,false);
let release;h.respond(()=>new Promise(resolve=>{release=resolve;}));button.props.onClick();button.props.onClick();assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1,'repeated clicks issue one POST');
assert.equal(h.statuses.at(-1),null,'saving invalidates parent start eligibility');tree=h.render();assert.match(text(tree),/Saving your channel choice/);assert.equal(find(tree,node=>node.type==='input'&&node.props.type==='checkbox').props.disabled,true);
assert.deepEqual(JSON.parse(h.calls.at(-1).options.body),{accepted:true,version:'fixture-v1',mode:'sms_inbound'});
release(new Response(JSON.stringify({error:'Changed'}),{status:409}));await tick();tree=h.render();assert.match(text(tree),/Refresh and review the latest text/);assert.equal(find(tree,node=>node.type==='input'&&node.props.type==='checkbox').props.checked,false);
h.respond(()=>Promise.resolve(new Response(JSON.stringify({...fixture,policy:{...fixture.policy,version:'fixture-v2'}}))));find(tree,node=>node.type==='button'&&text(node)==='Refresh campaign status').props.onClick();await tick();tree=h.render();assert.match(text(tree),/fixture-v2/);assert.equal(find(tree,node=>node.type==='input'&&node.props.type==='checkbox').props.checked,false);
find(tree,node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});tree=h.render();
const saved={...fixture,policy:{...fixture.policy,version:'fixture-v2'},acknowledgment:{version:'fixture-v2',acceptedAt:'2026-09-30T12:00:00Z'},configured:true};
h.respond((url,options)=>Promise.resolve(new Response(JSON.stringify(options.method==='POST'?{saved:true}:saved))));find(tree,node=>node.type==='button'&&text(node)==='Save outreach channels').props.onClick();await tick();tree=h.render();assert.match(text(tree),/Responsibilities acknowledged/);assert.match(text(tree),/Review and save your channel choice/);assert.equal(elements(tree).filter(node=>node.type==='input'&&node.props.type==='checkbox').length,1);assert.equal(h.calls.at(-1).options.cache,'no-store','saved state verified by GET');
h.respond(()=>Promise.resolve(new Response(JSON.stringify({...saved,liveWorkReady:true,released:false}))));find(tree,node=>node.type==='button'&&text(node)==='Refresh campaign status').props.onClick();await tick();tree=h.render();assert.match(text(tree),/Review and save your channel choice/);assert.doesNotMatch(text(tree),/Setup checks ready/,'unreleased campaign is never presented as ready');
h.respond(()=>Promise.resolve(new Response(JSON.stringify({...saved,liveWorkReady:true,released:true}))));find(tree,node=>node.type==='button'&&text(node)==='Refresh campaign status').props.onClick();await tick();tree=h.render();assert.match(text(tree),/SMS with inbound-call invitations selected/);
find(tree,node=>node.type==='input'&&node.props.value==='outbound_voice_sms').props.onChange();tree=h.render();assert.equal(find(tree,node=>node.type==='input'&&node.props.type==='checkbox').props.checked,false,'changing channels requires a new confirmation');
find(tree,node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});tree=h.render();assert.equal(find(tree,node=>node.type==='button'&&text(node)==='Save outreach channels').props.disabled,false);assert.match(text(tree),/does not mean your bot is running/);
assert.throws(()=>policy.parseCampaignStatus({...fixture,released:undefined}),'missing release state fails closed');
h.respond(()=>Promise.reject(Error('Network unavailable')));find(tree,node=>node.type==='button'&&text(node)==='Refresh campaign status').props.onClick();await tick();tree=h.render();assert.ok(find(tree,node=>node.props?.role==='alert'));assert.equal(h.statuses.at(-1),null,'failed refresh cannot leave parent start eligible');assert.doesNotMatch(text(tree),/Responsibilities acknowledged/,'do not present stale status as verified');h.unmount();
const aborted=harness();aborted.respond(()=>new Promise(()=>{}));aborted.render();aborted.mount();aborted.unmount();assert.equal(aborted.calls[0].options.signal.aborted,true);
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');assert.match(page,/<OutreachCampaignAcknowledgment statusOnly onStatus=\{setCampaign\}\/>/);assert.match(page,/!guest&&<OutreachCampaignAcknowledgment statusOnly/,'campaign readiness remains mounted without provider controls in the customer workspace');
assert.ok(h.calls.every(c=>c.url==='/api/work/outreach-campaign'),'UI cannot activate or charge');
console.log('Campaign UI state and component handler tests passed: explicit acknowledgment, keyboard-native controls, loading, errors, version changes, repeated clicks, server verification, and unmount.');
