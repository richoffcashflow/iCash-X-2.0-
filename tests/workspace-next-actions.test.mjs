import assert from 'node:assert/strict';
import {propertyNextAction} from '../lib/workspace-guidance.ts';
import {closingSetupNext} from '../lib/closing-setup.ts';
import {openDealSection,revealWorkspaceSection} from '../lib/workspace-navigation.ts';
import {makeWorkspaceFixture} from './fixtures/workspace-volume.mjs';
const fixture=makeWorkspaceFixture(),property=fixture.properties[1],deal={...fixture.deals[1],stage:'under_contract'};
const work={...fixture,deals:[deal],signing:[],handoffs:[],callbacks:[],textAttention:[],callRequests:[],propertyAttentionIds:[],closingTasks:[],closingReview:[],viewingRequests:[]};
const next=patch=>propertyNextAction(property,{...work,...patch});
assert.equal(next({}).target,'fulfillment');
assert.equal(next({signing:[{deal_id:deal.id,state:'customer_signature_needed',test_mode:false}],closingTasks:[{screening_id:property.id}]}).target,'contracts','a completed purchase stage must not hide a pending owner signature');
assert.equal(next({handoffs:[{screening_id:property.id,state:'open'}],closingReview:[{screening_id:property.id,review_reason:'setup'}]}).target,'attention','a person request wins over routine setup');
assert.equal(next({viewingRequests:[{screening_id:property.id}],closingReview:[{screening_id:property.id,review_reason:'setup'}]}).target,'attention');
assert.match(next({closingTasks:[{screening_id:property.id}],closingReview:[{screening_id:property.id,review_reason:'setup'}]}).detail,/signed agreement/,'deadline review is not obscured by setup');
assert.equal(next({closingReview:[{screening_id:property.id,review_reason:'payment_change'}],viewingRequests:[{screening_id:property.id}]}).label,'Review closing issue');
assert.equal(next({closingReview:[{screening_id:property.id,review_reason:'setup'}]}).label,'Set up closing');
assert.equal(next({handoffs:[{screening_id:'another-property',state:'open'}]}).target,'fulfillment','another property does not redirect this deal');
assert.equal(next({deals:[{...deal,stage:'cancellation_pending'}],signing:[{deal_id:deal.id,state:'customer_signature_needed'}]}).target,'cancellation');
assert.equal(next({deals:[{...deal,stage:'closed'}],closingReview:[{screening_id:property.id}]}).label,'Review closing record');
assert.equal(next({deals:[{...deal,stage:'cancelled'}]}).target,'contracts');

const empty={setup:null,verifiedContact:null,directory:[],buyerSuggestions:[],titleEmailInAgreement:null};
assert.equal(closingSetupNext(empty).action,'title');
assert.equal(closingSetupNext({...empty,buyerSuggestions:[{id:'buyer',title_quote:'Try our closer'}]}).action,'title','a suggestion is not verified title');
const setup={review_reason:'setup',payout:null,title_proposal:{company:'Fixture Title',closer:'Fixture Closer',email:'closer@example.test',phone:'+12025550100'}};
assert.equal(closingSetupNext({...empty,setup:{...setup,title_proposal:{...setup.title_proposal,phone:''}}}).action,'title');
assert.equal(closingSetupNext({...empty,setup}).action,'verify','complete contact details still require independent confirmation');
const verified={...empty,setup,verifiedContact:{email:'closer@example.test'}};
assert.equal(closingSetupNext(verified).action,'payout');
const payout={payeeName:'Fixture LLC',payeeType:'company',method:'wire',mailingAddress:'',detailsSharedWithTitle:false};
assert.equal(closingSetupNext({...verified,setup:{...setup,payout}}).code,'secure_details');
const waiting=closingSetupNext({...verified,setup:{...setup,payout:{...payout,detailsSharedWithTitle:true}}});
assert.equal(waiting.action,null);assert.match(waiting.text,/Title still needs to approve/,'saved preferences do not imply payment or a completed closing');
assert.equal(closingSetupNext({...verified,setup:{...setup,review_reason:'payment_change'}}).code,'human_review');

// Navigation reveals existing controls, preserves sibling disclosures and moves focus.
function node(tagName,parentElement=null){return {tagName,parentElement,open:false,scrollIntoView(){this.scrolled=true;},focus(){this.focused=true;}};}
const outer=node('DETAILS'),target=node('DETAILS',node('DIV',outer)),sibling=node('DETAILS');
const origin={closest(selector){assert.equal(selector,'.live-property');return {querySelector(selector){assert.equal(selector,'[data-deal-section="contracts"]');return target;}};}};
assert(openDealSection(origin,'contracts'));assert(target.open&&outer.open&&target.focused&&target.scrolled);assert.equal(target.tabIndex,-1);assert.equal(sibling.open,false);
assert.equal(revealWorkspaceSection(null),false);
const priorDocument=globalThis.document,attention=node('DETAILS');
try{globalThis.document={getElementById(id){assert.equal(id,'workspace-attention');return attention;}};assert(openDealSection(origin,'attention'));assert(attention.open&&attention.focused);}finally{globalThis.document=priorDocument;}
console.log('Workspace next actions: signatures, human requests, deadlines, cancellation, title/payment handoffs and disclosure focus passed. No provider calls.');
