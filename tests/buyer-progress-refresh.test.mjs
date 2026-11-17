import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {journeyNextAction} from '../lib/deal-journey-progress.ts';
import {analysisMoney} from '../lib/property-analysis-view.ts';
import {buyerDepositMethods,buyerDepositMethodLabels,sellerViewingSlots,viewingSlotLabel} from '../lib/buyer-purchase-terms.ts';
import {safeLocalTime} from '../components/workspace-view.ts';

// Run the real two-level components with fictional API receipts. This checks
// state updates and request counts without contacting a buyer or moving money.
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):'';
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const dealId='11111111-1111-4111-8111-111111111111';
const baseJourney={id:'journey',deal_id:dealId,screening_id:'screening',state:'deposit_due',wants_assignment:true,wants_viewing:false,review_reason:null,deposit_due_at:'2026-12-01T16:00:00Z',last_progress_at:'2026-11-17T01:00:00Z',envelopeState:'completed',messageReview:false,hasSlots:false,showingState:null,titleState:null,titleSelected:false,closingKind:null};
function harness(file,exportName,initialProps){
 let props=initialProps,slots=[],cursor=0,dirty=true,effects=[],tree;
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}
 };
 const deps={react:hooks,'react/jsx-runtime':require('react/jsx-runtime'),'@/lib/deal-journey-progress':{journeyNextAction},'./workspace-view':{safeLocalTime},'./journey-recovery':{JourneyRecovery:'JourneyRecovery'},'./date-time-input':{DateTimeInput:'DateTimeInput'},'@/lib/workspace-experience-client':{recordWorkspaceExperience(){}},'./deal-journey-status':{DealJourneyStatus:'DealJourneyStatus'},'./buyer-showings':{BuyerShowings:'BuyerShowings'},'@/lib/property-analysis-view':{analysisMoney},'@/lib/buyer-purchase-terms':{buyerDepositMethods,buyerDepositMethodLabels,sellerViewingSlots,viewingSlotLabel}};
 const code=ts.transpileModule(readFileSync(new URL('../components/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};new Function('require','module','exports',code)(name=>{assert(name in deps,'Unmocked import '+name);return deps[name];},mod,mod.exports);
 return {
  async flush(){do{if(dirty){cursor=0;dirty=false;tree=mod.exports[exportName](props);}const pending=effects;effects=[];pending.forEach(fn=>fn());await tick();}while(dirty||effects.length);},
  update(next){props={...props,...next};dirty=true;},
  find(predicate){const result=elements(tree).find(predicate);assert(result,'Missing control in '+text(tree));return result;},
  all:()=>elements(tree),text:()=>text(tree),
  dispose(){slots.forEach(slot=>slot?.cleanup?.());}
 };
}
const button=(ui,label)=>ui.find(n=>n.type==='button'&&text(n)===label);
const input=(ui,label,type)=>ui.find(n=>n.type==='label'&&text(n).startsWith(label)).props.children.find?.(n=>n?.type===type);
async function mountedPair(){
 const parent=harness('buyer-deal-coordination.tsx','BuyerDealCoordination',{dealId,embedded:true});await parent.flush();
 const child=harness('deal-journey-status.tsx','DealJourneyStatus',parent.find(n=>n.type==='DealJourneyStatus').props);await child.flush();
 return {parent,child,async flush(){await parent.flush();child.update(parent.find(n=>n.type==='DealJourneyStatus').props);await child.flush();},dispose(){parent.dispose();child.dispose();}};
}
let failures=0,count=0;
async function scenario(name,run){try{await run();console.log('PASS '+(++count)+': '+name);}catch(error){failures++;console.error('FAIL '+name,error);}}
try{
 await scenario('the refresh button updates buyer next step and preserves unsaved deadline and seller times',async()=>{
  let journey={...baseJourney},reads=0,writes=0;
  globalThis.fetch=async(path,init={})=>{if(init.method==='POST'){writes++;assert.fail('Refresh cannot write');}if(path.startsWith('/api/work/journeys')){reads++;return Response.json({journeys:[journey],messages:[]});}return Response.json({availability:null,receipt:null,assignment:null});};
  const ui=await mountedPair();try{
   ui.child.find(n=>n.type==='DateTimeInput').props.onChange({target:{value:'2026-12-02T11:00'}});
   ui.parent.find(n=>n.type==='textarea').props.onChange({target:{value:'Seller offered Saturday afternoon.'}});
   ui.parent.find(n=>n.type==='DateTimeInput').props.onChange({target:{value:'2026-12-05T14:00'}});await ui.flush();
   journey={...journey,titleSelected:true,state:'reserved'};button(ui.parent,'Refresh buyer progress').props.onClick();await ui.flush();
   assert.equal(reads,2);assert.match(ui.child.text(),/property is reserved/);assert.equal(writes,0);
   assert.equal(ui.parent.find(n=>n.type==='textarea').props.value,'Seller offered Saturday afternoon.');assert.equal(ui.parent.find(n=>n.type==='DateTimeInput').props.value,'2026-12-05T14:00');
   journey={...baseJourney};button(ui.parent,'Refresh buyer progress').props.onClick();await ui.flush();
   assert.equal(ui.child.find(n=>n.type==='DateTimeInput').props.value,'2026-12-02T11:00');
  }finally{ui.dispose();}
 });
 await scenario('confirming an exact deposit receipt refreshes the child once without repeating the write',async()=>{
  let journey={...baseJourney},receipt=null,reads=0,writes=0;
  globalThis.fetch=async(path,init={})=>{if(init.method==='POST'){writes++;const body=JSON.parse(init.body);assert.equal(body.action,'deposit');assert.equal(body.dealId,dealId);assert.equal(body.cleared,true);assert.equal(body.amountCents,200000);assert.equal(body.reference,'fixture-receipt');assert(body.key);receipt={amount_cents:200000,method:'wire',reference:'fixture-receipt'};journey={...journey,state:'reserved'};return Response.json({saved:true});}if(path.startsWith('/api/work/journeys')){reads++;return Response.json({journeys:[journey],messages:[]});}return Response.json({availability:null,receipt,assignment:{id:'assignment',buyer:'Fixture Buyer',depositCents:200000}});};
  const ui=await mountedPair();try{
   input(ui.parent,'Receipt or transaction reference','input').props.onChange({target:{value:'fixture-receipt'}});
   ui.parent.find(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.checked===false&&ui.parent.all().some(p=>p.type==='label'&&text(p).trim().startsWith('I verified')&&elements(p).includes(n))).props.onChange({target:{checked:true}});await ui.flush();
   button(ui.parent,'Confirm receipt & reserve property').props.onClick();await ui.flush();
   assert.equal(writes,1);assert.equal(reads,2);assert.match(ui.parent.text(),/Reserved/);assert.match(ui.child.text(),/buyer’s deposit is verified/);assert.doesNotMatch(ui.child.text(),/Give the buyer verified receiving instructions/);
  }finally{ui.dispose();}
 });
 await scenario('a saved agreed deadline is reread; editing or a rejected next save clears its old success',async()=>{
  let journey={...baseJourney},reads=0,writes=0,saveAllowed=true,releaseSave;
  globalThis.fetch=async(_path,init={})=>{if(init.method==='POST'){writes++;const body=JSON.parse(init.body);assert.equal(body.dealId,dealId);if(!saveAllowed)return Response.json({error:'Recheck the agreed deadline.'},{status:409});journey={...journey,deposit_due_at:body.dueAt};return new Promise(resolve=>{releaseSave=()=>resolve(Response.json({saved:true}));});}reads++;return Response.json({journeys:[journey],messages:[]});};
  const ui=harness('deal-journey-status.tsx','DealJourneyStatus',{dealId});try{
   await ui.flush();ui.find(n=>n.type==='DateTimeInput').props.onChange({target:{value:'2026-12-02T11:00'}});ui.find(n=>n.type==='input').props.onChange({target:{value:'Signed contract section 4'}});await ui.flush();
   const saving=button(ui,'Save agreed deadline').props.onClick();await ui.flush();assert.equal(ui.find(n=>n.type==='DateTimeInput').props.disabled,true);assert.equal(ui.find(n=>n.type==='input').props.disabled,true);releaseSave();await saving;await ui.flush();assert.equal(reads,2);assert.equal(writes,1);assert.match(ui.text(),/Deadline saved/);assert(ui.text().includes(safeLocalTime(journey.deposit_due_at)));
   ui.find(n=>n.type==='DateTimeInput').props.onChange({target:{value:'2026-12-03T11:00'}});await ui.flush();assert.doesNotMatch(ui.text(),/Deadline saved/);
   saveAllowed=false;await button(ui,'Save agreed deadline').props.onClick();await ui.flush();assert.equal(reads,2);assert.equal(writes,2);assert.match(ui.text(),/Recheck the agreed deadline/);assert.doesNotMatch(ui.text(),/Deadline saved/);
  }finally{ui.dispose();}
 });
 await scenario('visit refresh keeps the original selected version and confirmation drafts; a saved visit refreshes the journey',async()=>{
  let journey={...baseJourney,state:'collecting',wants_viewing:true,wants_assignment:false,showingState:'proposed'},writes=0,reads=0;
  let showing={id:'showing',version:1,buyer_name:'Fixture Buyer',starts_at:'2026-12-02T17:00:00Z',ends_at:'2026-12-02T18:00:00Z',timezone:'America/Chicago',state:'proposed',seller_confirmed_at:null,buyer_confirmed_at:'2026-11-17T01:00:00Z',seller_note:null,buyer_note:'Agreed',change_note:null};
  globalThis.fetch=async(path,init={})=>{if(init.method==='POST'){writes++;const body=JSON.parse(init.body);assert.equal(body.dealId,dealId);assert.equal(body.id,showing.id);if(body.version!==showing.version)return Response.json({error:'The visit changed. Review the current time.'},{status:409});assert.equal(body.action,'confirm_seller');assert.equal(body.data.note,'Seller agreed to this exact time');journey={...journey,showingState:'confirmed'};showing={...showing,state:'confirmed',seller_confirmed_at:'2026-11-17T02:00:00Z'};return Response.json({message:'Visit confirmed.'});}if(path.startsWith('/api/work/showings'))return Response.json({showings:[showing],requests:[]});if(path.startsWith('/api/work/journeys')){reads++;return Response.json({journeys:[journey],messages:[]});}return Response.json({availability:null,receipt:null,assignment:null});};
  const ui=await mountedPair(),visits=harness('buyer-showings.tsx','BuyerShowings',ui.parent.find(n=>n.type==='BuyerShowings').props);
  const flush=async()=>{await ui.flush();visits.update(ui.parent.find(n=>n.type==='BuyerShowings').props);await visits.flush();};
  try{
   await visits.flush();const details=visits.find(n=>n.type==='details');const target={open:true};details.props.onToggle({target,currentTarget:target});await visits.flush();
   button(visits,'Manage visit').props.onClick();await visits.flush();visits.find(n=>n.type==='textarea').props.onChange({target:{value:'Unsaved seller confirmation'}});await visits.flush();
   showing={...showing,version:2,starts_at:'2026-12-03T17:00:00Z',ends_at:'2026-12-03T18:00:00Z'};button(ui.parent,'Refresh buyer progress').props.onClick();await flush();
   assert.equal(visits.find(n=>n.type==='textarea').props.value,'Unsaved seller confirmation');assert(visits.text().includes(safeLocalTime('2026-12-02T17:00:00Z','America/Chicago')),'selected attestation keeps its original time');assert(visits.text().includes(safeLocalTime(showing.starts_at,showing.timezone)),'fresh saved visit is displayed separately');
   visits.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await visits.flush();visits.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await visits.flush();assert.match(visits.text(),/visit changed/);assert.equal(writes,1);assert.equal(journey.showingState,'proposed');
   button(visits,'Manage visit').props.onClick();await visits.flush();visits.find(n=>n.type==='textarea').props.onChange({target:{value:'Seller agreed to this exact time'}});visits.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await visits.flush();
   visits.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await visits.flush();await flush();assert.equal(writes,2);assert.equal(reads,3);assert.match(ui.child.text(),/visit is confirmed/);assert.match(visits.text(),/Visit confirmed/);
  }finally{visits.dispose();ui.dispose();}
 });
 await scenario('closed buyer requests remain history and cannot resurrect a blocker or fresh-contact prompt',async()=>{
  const journey={...baseJourney,state:'closed',messageReview:true,envelopeState:'customer_signature_needed',last_progress_at:'2020-01-01T00:00:00Z',blocker:{kind:'human',note:'Historic request',revision:1,updatedAt:'2020-01-01T00:00:00Z'}};
  globalThis.fetch=async()=>Response.json({journeys:[journey],messages:[{id:'original',state:'needs_review',event_key:'buyer_reminder',deliveryState:null}]});
  const ui=harness('deal-journey-status.tsx','DealJourneyStatus',{dealId});try{await ui.flush();assert.match(ui.text(),/Buyer request closed/);assert.match(ui.text(),/earlier message still needs delivery review/);assert.match(ui.text(),/Saved buyer request:  Historic request/);assert.match(ui.text(),/delivery evidence before retrying/,'unknown historical delivery stays visible');assert.equal(ui.all().filter(n=>n.type==='JourneyRecovery').length,0);assert.doesNotMatch(ui.text(),/Waiting on|buyer has not progressed|complete your signature/);}finally{ui.dispose();}
  assert.equal(journeyNextAction(journey).label,'View buyer history');
  const ordinaryClosed=journeyNextAction({...journey,messageReview:false,blocker:null});assert.equal(ordinaryClosed.waitingOn,'No one');assert.match(ordinaryClosed.detail,/saved messages and agreements remain available/);assert.doesNotMatch(ordinaryClosed.detail,/signed|received|paid|closing complete/i);
  const expired=journeyNextAction({...baseJourney,state:'needs_review',review_reason:'Buyer request link expired; follow up with the buyer'});assert.equal(expired.waitingOn,'You');assert.match(expired.detail,/link expired/,'expired requests retain their real review action');
 });
 await scenario('an unavailable initial visit read stops loading and a later read can recover',async()=>{
  let reads=0;globalThis.fetch=async()=>++reads===1?Response.json({error:'Could not load visits.'},{status:503}):Response.json({showings:[],requests:[]});
  const ui=harness('buyer-showings.tsx','BuyerShowings',{dealId,refreshKey:0});try{
   await ui.flush();const target={open:true};ui.find(n=>n.type==='details').props.onToggle({target,currentTarget:target});await ui.flush();assert.match(ui.text(),/Could not load visits/);assert.doesNotMatch(ui.text(),/Loading visits/);
   ui.update({refreshKey:1});await ui.flush();assert.doesNotMatch(ui.text(),/Could not load visits|Loading visits/);assert.match(ui.text(),/No open buyer viewing requests/);
  }finally{ui.dispose();}
 });
 await scenario('age alone never claims the scheduled reminders were sent',async()=>{
  const next=journeyNextAction({...baseJourney,state:'collecting',last_progress_at:'2020-01-01T00:00:00Z',envelopeState:null});assert.equal(next.waitingOn,'You');assert.match(next.detail,/recorded for three days/);assert.match(next.detail,/Review the saved replies and follow-ups/);assert.doesNotMatch(next.detail,/after the scheduled follow-ups/);
 });
}finally{globalThis.fetch=originalFetch;}
assert.equal(failures,0,`${failures} buyer progress regressions failed`);
console.log(`${count} buyer progress scenarios passed without external requests.`);
