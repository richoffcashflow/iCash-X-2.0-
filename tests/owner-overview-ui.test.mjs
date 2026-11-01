import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {webinarRequest} from '../lib/webinar-client.ts';
import * as overview from '../lib/owner-overview.ts';
import * as priority from '../lib/reliability-priority.ts';
import * as funnel from '../lib/conversion-funnel.ts';
import * as costEvidenceModule from '../lib/owner-cost-evidence.ts';
const OwnerOutreachView=()=>null;
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
const nodes=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.props?.children)];
const text=root=>typeof root==='string'||typeof root==='number'?String(root):Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';
const fixture=(url,label='Private seller')=>{
 const q=new URL(url,'https://example.invalid').searchParams;
 return {report:{days:Number(q.get('days')),includeOwner:q.get('includeOwner')==='true',query:q.get('q'),page:Number(q.get('page')),pageSize:25,timezone:'America/Chicago',startAt:'2026-10-10T05:00:00Z',endAt:'2026-10-10T12:30:00Z',funnel:funnel.sellerFunnelStages.map((s,i)=>({key:s.key,count:i<2?1:0})),leadCount:1,reviewCount:0,matchedCount:1,leads:[{id:'fixture',name:label,address:'Fixture property',phone:'+12145550123',email:null,state:'assigned',source:'direct',campaign:null,assignedTo:'Fixture account',createdAt:'2026-10-10T08:00:00Z'}],usage:{chargedCents:label==='Today seller'?200:label==='Stale seller'?300:100,completedCount:1,costMicros:200000,coveredCents:0,estimatedCount:1,knownCostMicros:200000,marginMicros:label==='Today seller'?1800000:label==='Stale seller'?2800000:800000,missingChargeCount:0,missingCostCount:0,pendingCount:0}}};
};
function harness(){
 let slots=[],cursor=0,dirty=true,pending=[],tree;
 const listeners=new Map();
 globalThis.document={visibilityState:'visible',addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);}};
 globalThis.window={addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);}};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],next=>{const v=typeof next==='function'?next(slots[i]):next;if(!Object.is(v,slots[i])){slots[i]=v;dirty=true;}}];},useEffect(fn,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((v,n)=>!Object.is(v,prior.deps[n]))){slots[i]={deps,cleanup:prior?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 const code=ts.transpileModule(readFileSync(new URL('../app/admin/overview.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}},deps={react:hooks,'@/lib/reliability-priority':priority,'@/lib/webinar-client':{webinarRequest:(path,init)=>webinarRequest(path,init,40)},'@/lib/owner-overview':overview,'@/lib/conversion-funnel':funnel,'./outreach':{OwnerOutreachView},'@/components/account-access':{AccountAccess:'AccountAccess'}};
 deps['@/lib/owner-cost-evidence']=costEvidenceModule;
 new Function('require','module','exports',code)(name=>deps[name]??(name==='react/jsx-runtime'?require(name):{default:{}}),mod,mod.exports);
 return {async flush(){for(let i=0;i<20;i++){if(dirty){cursor=0;dirty=false;tree=mod.exports.OwnerOverviewView();}const effects=pending;pending=[];effects.forEach(fn=>fn());await tick();if(!dirty&&!pending.length)return;}throw Error('Render did not settle');},find(predicate){const node=nodes(tree).find(predicate);assert(node,'Expected UI control');return node;},text:()=>text(tree),focus:()=>listeners.get('focus')?.(),dispose(){slots.forEach(s=>s?.cleanup?.());}};
}
let count=0;
async function scenario(name,fn){await fn();console.log(`PASS ${++count}/8 ${name}`);}
try{
 await scenario('Switching periods cancels old reads and never displays old totals under a new filter',async()=>{
  let late,signal;globalThis.fetch=async(path,init)=>{if(path.includes('days=7&')){signal=init.signal;return new Promise(resolve=>{late=resolve;});}return Response.json(fixture(path,path.includes('days=1&')?'Today seller':'Private seller'));};
  const ui=harness();try{await ui.flush();assert.match(ui.text(),/\$1.00/);assert.equal(ui.find(n=>n.type===OwnerOutreachView).props.days,30);ui.find(n=>n.type==='button'&&text(n)==='7 days').props.onClick();await ui.flush();assert(!ui.text().includes('$1.00'));ui.find(n=>n.type==='button'&&text(n)==='Today').props.onClick();await ui.flush();assert(signal.aborted);assert.match(ui.text(),/\$2.00/);late(Response.json(fixture('/?days=7&includeOwner=false&q=&page=1','Stale seller')));await ui.flush();assert(!ui.text().includes('$3.00'));}finally{ui.dispose();}
 });
 await scenario('Refresh failure preserves a clearly labelled prior view and retry recovers',async()=>{
  let failed=false;globalThis.fetch=async path=>failed?Response.json({error:'Temporary outage'},{status:503}):Response.json(fixture(path));
  const ui=harness();try{await ui.flush();failed=true;ui.find(n=>n.type==='button'&&text(n)==='Refresh').props.onClick();await ui.flush();assert.match(ui.text(),/Refresh failed/);assert.match(ui.text(),/\$1.00/);assert.match(ui.text(),/Last successful update/);failed=false;ui.find(n=>n.type==='button'&&text(n)==='Try again').props.onClick();await ui.flush();assert(!ui.text().includes('Refresh failed'));}finally{ui.dispose();}
 });
 await scenario('Lost authorization erases private leads and stops background requests',async()=>{
  let status=200,calls=0;globalThis.fetch=async path=>{calls++;return status===200?Response.json(fixture(path)):Response.json({error:'Owner required'},{status});};
  const ui=harness();try{await ui.flush();status=403;ui.focus();await ui.flush();assert.match(ui.text(),/Owner access only/);assert(!ui.text().includes('$1.00'));assert(!ui.text().includes('$0.80'));assert(!ui.text().includes('Private seller'));const before=calls;ui.focus();await ui.flush();assert.equal(calls,before);}finally{ui.dispose();}
 });
 await scenario('A stalled read releases Refresh and duplicate focus events do not create more requests',async()=>{
  let calls=0,signal;globalThis.fetch=async(_path,init)=>{calls++;signal=init.signal;return new Promise(()=>{});};
  const ui=harness();try{await ui.flush();ui.focus();ui.focus();await new Promise(resolve=>setTimeout(resolve,50));await ui.flush();assert.equal(calls,1);assert(signal.aborted);assert.match(ui.text(),/too long/);assert.equal(ui.find(n=>n.type==='button'&&text(n)==='Refresh').props.disabled,false);assert(!ui.text().includes('$0.00'));}finally{ui.dispose();}
 });
 await scenario('Admin shows inbound requests alongside outbound reporting while preserving earnings',async()=>{
  globalThis.fetch=async path=>Response.json(fixture(path));const ui=harness();
  try{await ui.flush();assert.equal(ui.find(n=>n.type===OwnerOutreachView).props.includeOwner,false);assert.match(ui.text(),/Usage charged/);assert.match(ui.text(),/\$0.80/);assert.match(ui.text(),/Inbound seller leads/);assert.match(ui.text(),/Private seller/);assert.match(ui.text(),/Fixture account/);assert.match(ui.text(),/Website \/ direct/);ui.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await ui.flush();assert.equal(ui.find(n=>n.type===OwnerOutreachView).props.includeOwner,true);}finally{ui.dispose();}
 });
 await scenario('Inbound search and later pages preserve outbound filters and show missing addresses honestly',async()=>{
  const requests=[];globalThis.fetch=async path=>{requests.push(path);const f=fixture(path),r=f.report;r.leadCount=r.matchedCount=26;r.funnel[0].count=26;r.leads=Array.from({length:r.page===1?25:1},(_,i)=>({...r.leads[0],id:`lead-${r.page}-${i}`,name:r.page===1?`Seller ${i}`:'Last seller',address:null,state:'awaiting_address',source:'meta'}));if(r.query==='missing'){r.matchedCount=0;r.leads=[];}return Response.json(f);};
  const ui=harness();try{await ui.flush();assert.match(ui.text(),/Waiting for property address/);assert.match(ui.text(),/Collecting address/);assert.match(ui.text(),/Meta form/);ui.find(n=>n.type==='button'&&text(n)==='Next inbound leads').props.onClick();await ui.flush();assert.match(ui.text(),/Last seller/);assert.match(ui.text(),/26–26 of 26 leads/);ui.find(n=>n.type==='input'&&n.props.id==='inbound-search').props.onChange({target:{value:'missing'}});await ui.flush();ui.find(n=>n.type==='form'&&n.props['aria-label']==='Search inbound leads').props.onSubmit({preventDefault(){}});await ui.flush();assert.match(ui.text(),/No inbound leads match/);assert.equal(ui.find(n=>n.type===OwnerOutreachView).props.days,30);assert(requests.at(-1).includes('page=1'));assert(requests.at(-1).includes('q=missing'));ui.find(n=>n.type==='button'&&text(n)==='Clear inbound search').props.onClick();await ui.flush();assert.match(ui.text(),/Seller 0/);}finally{ui.dispose();}
 });
 await scenario('Malformed successful responses show an error instead of fake zero totals',async()=>{
  globalThis.fetch=async()=>Response.json({report:{}});const ui=harness();try{await ui.flush();assert.match(ui.text(),/incomplete data/);assert(!ui.text().includes('$0.00'));}finally{ui.dispose();}
 });
 await scenario('Cost evidence distinguishes estimates, unknown classifications and unmatched breakdowns',async()=>{
  globalThis.fetch=async path=>{const f=fixture(path),r=f.report;r.costEvidence={days:r.days,includeOwner:r.includeOwner,startAt:r.startAt,endAt:r.endAt,completedCount:2,missingManifestCount:1,mismatchedManifestCount:0,recordedCostMicros:200000,verifiedMicros:25000,estimatedMicros:100000,unclassifiedMicros:75000,dealmachineCredits:12,providers:[{provider:'dealmachine',verifiedMicros:0,estimatedMicros:100000,unclassifiedMicros:75000},{provider:'elevenlabs',verifiedMicros:25000,estimatedMicros:0,unclassifiedMicros:0}]};return Response.json(f);};
  const ui=harness();try{await ui.flush();const body=ui.text().replace(/\s+/g,' ');assert.match(body,/Verified components \$0.03/);assert.match(body,/Estimated components \$0.10/);assert.match(body,/Unclassified components \$0.08/);assert.match(body,/1 missing cost breakdowns/);assert.match(body,/12 credits for settled operations/);assert.match(body,/Actual profit requires matching provider invoices/);assert.match(body,/ElevenLabs/);}finally{ui.dispose();}
 });
}finally{globalThis.fetch=originalFetch;}
assert.equal(count,8);
