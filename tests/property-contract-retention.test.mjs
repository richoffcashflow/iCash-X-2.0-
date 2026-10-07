import * as dealSummary from '../lib/deal-card-summary.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as view from '../components/workspace-view.ts';
import * as contracts from '../lib/property-contract-visibility.ts';
import * as guidance from '../lib/workspace-guidance.ts';
import * as analysis from '../lib/property-analysis-view.ts';
import * as milestone from '../lib/work-milestone.ts';
import * as documents from '../lib/deal-documents.ts';
import {makeWorkspaceFixture} from './fixtures/workspace-volume.mjs';

const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../components/live-workspace.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source+'\nexport {PropertyCard,DealTools};',{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const all=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(all):[node,...all(node.props?.children)];
const text=node=>typeof node==='string'?node:typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):'';

// Separate hook stores model a keyed card and its retained DealTools child.
// Effects run after rendering, so an effect-based reveal latch must survive a
// subsequent server response, not merely the initial readiness calculation.
let current,changed=false,pending=[];
const state=()=>({slots:[],cursor:0});
const hooks={
 Activity:'Activity',
 useState(initial){
  const owner=current,index=owner.cursor++;
  if(!(index in owner.slots))owner.slots[index]=typeof initial==='function'?initial():initial;
  return [owner.slots[index],value=>{const next=typeof value==='function'?value(owner.slots[index]):value;if(!Object.is(next,owner.slots[index])){owner.slots[index]=next;changed=true;}}];
 },
 useRef(initial){const index=current.cursor++;return current.slots[index]??=( {current:initial} );},
 useEffect(effect,deps){
  const owner=current,index=owner.cursor++,previous=owner.slots[index];
  if(!previous||deps.some((value,i)=>!Object.is(value,previous[i]))){owner.slots[index]=deps;pending.push(effect);}
 }
};
const mod={exports:{}};
new Function('require','module','exports',compiled)(name=>name==='react'?hooks:name==='react/jsx-runtime'?require(name):name==='./workspace-view'?view:name==='@/lib/work-milestone'?milestone:name==='@/lib/workspace-guidance'?guidance:name==='@/lib/property-analysis-view'?analysis:name==='@/lib/deal-card-summary'?dealSummary:name==='@/lib/property-contract-visibility'?contracts:name==='@/lib/deal-documents'?documents:{},mod,mod.exports);
const fixture=makeWorkspaceFixture(),property=fixture.properties[0];
const draft=fixture.deals[0],ready={...draft,terms:{...draft.terms,priceSource:'seller_reported'}};
const workFor=(deal,controls=[])=>({...fixture,deals:[deal],signing:[],controls});
const base={property,principal:'Synthetic Company',active:true,visited:true,hidden:false,onToggle(){},onRefresh(){}};

function mount(){
 const cardState=state();let childState=null,childType=null,childKey=null,card,tools;
 return props=>{
  let iterations=0;
  do{
   assert(++iterations<12,'effect/state updates must settle');changed=false;pending=[];
   current=cardState;current.cursor=0;card=mod.exports.PropertyCard({...base,...props});
   const child=all(card).find(node=>node.type===mod.exports.DealTools);
   if(child){
    if(!childState||child.type!==childType||child.key!==childKey)childState=state();
    childType=child.type;childKey=child.key;current=childState;current.cursor=0;tools=child.type(child.props);
   }else{childState=null;childType=null;childKey=null;tools=null;}
   const effects=pending;pending=[];for(const effect of effects)effect();
  }while(changed);
  return {card,tools};
 };
}

const render=mount();
assert.equal(render({work:workFor(draft)}).tools,null,'an untouched early draft stays hidden');
let result=render({work:workFor(ready)});
assert(result.tools,'recorded seller readiness reveals the contract tools');
const sellerInput=all(result.tools).find(node=>node.type==='input'&&node.props.value==='Example Seller');
assert(sellerInput);sellerInput.props.onChange({target:{value:'Unsaved Seller Edit'}});
result=render({work:workFor(ready)});
assert.equal(result.tools.props['data-unsaved-draft'],'true');
assert(all(result.tools).some(node=>node.type==='input'&&node.props.value==='Unsaved Seller Edit'));

// A later authenticated activity response can remove or revise readiness.
// Visibility must not unmount an already-open editor and discard its draft.
result=render({work:workFor(draft)});
assert(result.tools,'readiness true → false retains the mounted editor');
assert.equal(result.tools.props['data-unsaved-draft'],'true','the unsaved-work guard remains mounted');
assert(all(result.tools).some(node=>node.type==='input'&&node.props.value==='Unsaved Seller Edit'),'server readiness changes preserve edited terms');
result=render({work:workFor(draft),active:false,hidden:true});
assert.equal(all(result.card).find(node=>node.type==='Activity').props.mode,'hidden');
assert(result.tools,'collapse/filter preserves contract state');
result=render({work:workFor(draft),photoRefresh:1});
assert(all(result.tools).some(node=>node.type==='input'&&node.props.value==='Unsaved Seller Edit'),'explicit photo/workspace refresh never remounts the contract editor');
assert.equal(mount()({work:workFor(draft)}).tools,null,'the reveal latch does not leak into another card mount');

const manualRender=mount(),manualWork=workFor(draft,[{property_id:property.result.property.propertyId}]);
result=manualRender({work:manualWork});
assert.equal(result.tools,null);
const reveal=all(result.card).find(node=>node.type==='button'&&text(node)==='Seller is ready for an agreement');
assert(reveal);reveal.props.onClick();
assert(manualRender({work:manualWork}).tools,'explicit manual preparation reveals the editor');
assert(manualRender({work:workFor(draft)}).tools,'returning property control retains the open editor');

console.log('Property contract retention: queued reveal effects, readiness regression, unsaved terms, collapsed/filter state, explicit refresh and mount isolation passed.');
