import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {dealToolVisibility,showPropertyContract} from '../lib/property-contract-visibility.ts';
import * as terms from '../lib/buyer-purchase-terms.ts';
import * as analysis from '../lib/property-analysis-view.ts';
import * as dates from '../components/workspace-view.ts';

const deal={id:'fixture-deal',stage:'draft'},signed={deal_id:deal.id,kind:'purchase',state:'completed',test_mode:false};
const hidden={buyers:false,coordination:false,buyerReview:false};
assert.deepEqual(dealToolVisibility(undefined,[]),hidden);
for(const signature of [[],[{...signed,state:'sent'}],[{...signed,test_mode:true}],[{...signed,deal_id:'other'}]]){
 assert.deepEqual(dealToolVisibility(deal,signature),hidden,'early and test agreements do not introduce buyer tools');
}
assert.deepEqual(dealToolVisibility(deal,[signed]),{buyers:true,coordination:true,buyerReview:true});
assert.equal(dealToolVisibility({...deal,stage:'closed'},[signed]).buyerReview,true,'completed deals retain their saved buyer reviews');
assert.equal(showPropertyContract({...deal,stage:'canceled',terms:{}},[]),true,'stopped deals retain their agreements even if the signature list is unavailable');
assert.deepEqual(dealToolVisibility(deal,[],null,true),{buyers:true,coordination:true,buyerReview:false},'existing buyer activity stays accessible without claiming a verified contract');
for(const stage of ['under_contract','buyer_selected','title_open','closing','closed']){
 const view=dealToolVisibility({...deal,stage},[]);
 assert(view.buyers&&view.coordination,'saved later-stage records stay accessible');assert.equal(view.buyerReview,false);
}
for(const stage of ['cancellation_pending','cancelled','canceled'])assert.deepEqual(dealToolVisibility({...deal,stage},[signed]),hidden);
assert.equal(dealToolVisibility({...deal,stage:'cancellation_pending'},[signed],'fulfillment').buyers,true,'a current closing review is never hidden by stage filtering');
assert.equal(dealToolVisibility(deal,[],'coordination').coordination,true,'a current buyer action always has a reachable destination');

const require=createRequire(import.meta.url);
const all=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(all):[node,...all(node.props?.children)];
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):'';
function render(file,name,props,values=[]){
 let index=0;
 const hooks={useState:initial=>[index<values.length?values[index++]:(typeof initial==='function'?initial():initial),()=>{}],useEffect(){},useRef:value=>({current:value})};
 const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports',code)(name=>name==='react'?hooks:name==='react/jsx-runtime'?require(name):name==='@/lib/buyer-purchase-terms'?terms:name==='@/lib/property-analysis-view'?analysis:name==='./workspace-view'?dates:new Proxy({},{get:(_,key)=>String(key)}),mod,mod.exports);
 return mod.exports[name](props);
}
const cancel=(stage,view=null,error='')=>render('components/agreement-cancellation-controls.tsx','AgreementCancellationControls',{dealId:deal.id,stage,signingVersion:'',onUpdated(){}},[view,error,false]);
let node=cancel('under_contract',{requests:[],stage:'under_contract'});
assert.equal(node.type,'details');assert.equal(node.props.open,false,'cancellation starts collapsed');assert.equal(node.props['data-deal-section'],'cancellation');
assert(all(node).some(n=>n.type==='button'&&text(n)==='Cancel contract'),'the cancellation path remains available');
assert.equal(cancel('cancellation_pending').props.open,true,'a pending review is visible before its request finishes loading');
assert.equal(cancel('under_contract',{requests:[{state:'pending'}]}).props.open,true);
assert.equal(cancel('under_contract',{requests:[{state:'completed',late_activity:true}]}).props.open,true,'late signing activity stays visible');
assert.equal(cancel('under_contract',null,'Could not refresh').props.open,true,'a failed review never disappears inside a closed menu');

const coordination=data=>render('components/buyer-deal-coordination.tsx','BuyerDealCoordination',{dealId:deal.id},[true,data,0,'','',false]);
const base={availability:null,assignment:null,receipt:null};
node=coordination(base);
assert.equal(node.props['data-deal-section'],'coordination');assert.match(text(node.props.children[0]),/Visits & buyer deposit/);
assert(!all(node).some(n=>n.props.className==='buyer-deposit'),'no deposit form before a signed buyer agreement');
node=coordination({...base,assignment:{id:'fixture-assignment',buyer:'Fixture Buyer',depositCents:200000}});
assert(all(node).some(n=>n.props.className==='buyer-deposit'));assert.match(text(node),/Signed buyer agreement/);
assert.equal(all(node).find(n=>n.type==='button'&&text(n)==='Confirm receipt & reserve property').props.disabled,true,'cleared funds still require explicit confirmation');
node=coordination({...base,receipt:{amount_cents:200000,method:'wire',reference:'fixture receipt'}});
assert.match(text(node),/Reserved/,'existing receipts remain visible even if no current assignment is returned');

const tree=render('components/fulfillment-details.tsx','FulfillmentDetails',{dealId:deal.id,buyerReviewAvailable:true},[0,{documents:[],buyers:[]},'',false,'']);
assert(all(tree).some(n=>n.type==='BuyerQualificationPanel'),'buyer reviews stay mounted while closing documents are collapsed');
assert(all(tree).some(n=>n.props?.['data-deal-section']==='closing'),'closing next actions have a dedicated destination');
assert(all(tree).some(n=>n.type==='BuyerOverview'),'buyer activity appears before secondary closing tools');
console.log('PASS deal tools: stage-based visibility, reachable next actions, visible cancellation reviews, signed-agreement deposit gate and retained buyer drafts. Local fixtures only.');
