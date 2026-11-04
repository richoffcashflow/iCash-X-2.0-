// Exercise the actual collapsed card and its control handler with local receipts only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as guidance from '../lib/workspace-guidance.ts';
import * as view from '../components/workspace-view.ts';
import * as visibility from '../lib/property-contract-visibility.ts';
import * as summary from '../lib/deal-card-summary.ts';
import * as milestones from '../lib/work-milestone.ts';
import * as conversation from '../lib/conversation-display.ts';
import {makeWorkspaceFixture} from './fixtures/workspace-volume.mjs';

const require=createRequire(import.meta.url),mod={exports:{}},writes=[];
let slots=[],cursor=0,refreshed=0,pending;
const hooks={
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
 useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
 useEffect(){},Activity:'Activity',
};
const modules={
 react:hooks,'@/lib/workspace-guidance':guidance,'./workspace-view':view,
 '@/lib/property-contract-visibility':visibility,'@/lib/deal-card-summary':summary,
 '@/lib/work-milestone':milestones,'@/lib/conversation-display':conversation,
 '@/lib/webinar-client':{webinarRequest(path,options){writes.push({path,...JSON.parse(options.body)});return new Promise((resolve,reject)=>{pending={resolve,reject};});}},
};
const code=ts.transpileModule(readFileSync(new URL('../components/live-workspace.tsx',import.meta.url),'utf8')+'\nexport {PropertyCard};',{
 compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},
}).outputText;
new Function('require','module','exports',code)(name=>modules[name]??(name==='react/jsx-runtime'?require(name):new Proxy({},{get:(_,key)=>String(key)})),mod,mod.exports);
const all=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(all):[root,...all(root.props?.children)];
const text=root=>typeof root==='string'?root:Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';
const handback=tree=>all(tree).find(node=>node.props?.['aria-label']==='Buyer search control');
const button=tree=>all(handback(tree)).find(node=>node.type==='button');
const work=makeWorkspaceFixture({count:1,manualIds:['00000000-0000-4000-8000-000000000001']});
Object.assign(work,{textAttention:[],propertyAttentionIds:[],contacts:[],journeys:[],conversations:[]});
work.deals[0].stage='under_contract';
work.signing=[{id:'purchase',deal_id:work.deals[0].id,kind:'purchase',state:'completed',test_mode:false}];
Object.assign(work,{closingReview:[{screening_id:work.properties[0].id,review_reason:'setup'}],closingTasks:[{screening_id:work.properties[0].id,kind:'deadline',state:'needs_review'}],propertyAttentionIds:[work.properties[0].id],propertyNonSetupAttentionIds:[]});
const props={property:work.properties[0],work,principal:'Example Company',active:false,visited:false,hidden:false,botPaused:true,onToggle(){},onRefresh(){refreshed++;}};
const render=(patch={})=>{cursor=0;return mod.exports.PropertyCard({...props,...patch});};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

let tree=render();
assert.match(text(handback(tree)),/Buyer search is paused/);
assert.match(text(handback(tree)),/keeps your account paused until you choose Run/);
assert.equal(button(tree).props.children,'Let bot find a buyer');
assert.equal(writes.length,0,'Displaying a signed purchase never automatically returns manual control');
assert.equal(tree.props['data-expanded'],false,'The next step is available on a collapsed card');
const firstClick=button(tree).props.onClick;firstClick();firstClick();
assert.equal(writes.length,1,'Rapid repeated clicks share one in-flight control request');
tree=render();assert.equal(button(tree).props.disabled,true);assert.equal(button(tree).props.children,'Saving…');
pending.reject(new Error('Synthetic save failed'));await settle();tree=render();
assert(handback(tree),'The paused buyer-search explanation stays after a failed save');
assert.equal(button(tree).props.disabled,false);
assert.match(text(tree),/Could not confirm the control change/);
assert.equal(refreshed,0,'A failed change does not claim a confirmed refresh');
button(tree).props.onClick();pending.resolve({saved:true});await settle();tree=render();
assert.equal(handback(tree),undefined,'The confirmed return hides the manual-control prompt');
assert.equal(all(tree).find(node=>node.type==='PropertyCardHeader').props.manual,false);
assert.match(text(tree),/Your account remains paused until you choose Run/);
assert.equal(refreshed,1);
assert.deepEqual(writes,[1,2].map(()=>({path:'/api/work/control',action:'return_to_bot',screeningId:work.properties[0].id})),
 'Both intentional attempts use existing property control; neither resumes the account nor calls a paid provider');

slots=[];tree=render({stale:true});assert.equal(button(tree).props.disabled,true);
button(tree).props.onClick();assert.equal(writes.length,2,'Stale account data cannot change controls even if a callback is invoked');
slots=[];assert.equal(button(render({readOnly:true})),undefined,'Read-only cards never expose a return action');
slots=[];tree=render({botPaused:false});button(tree).props.onClick();pending.resolve({saved:true});await settle();
tree=render({botPaused:false});assert.match(text(tree),/Setup, credits and contact permissions still apply/);
assert.doesNotMatch(text(tree),/Buyer search is paused|Your account remains paused/);
console.log('PASS buyer handback: actual collapsed card, explicit return, request deduplication, failed-save retention, account Pause, stale/read-only restrictions and no paid calls.');
