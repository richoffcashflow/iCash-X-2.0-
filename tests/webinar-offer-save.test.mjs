import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import * as policy from '../lib/webinar-policy.ts';
import * as recordings from '../lib/webinar-recordings.ts';
import * as links from '../lib/webinar-links.ts';
import * as reporting from '../lib/webinar-reporting.ts';

async function moduleFor(file,deps){
 const key='webinarSave'+Math.random().toString(36).slice(2);globalThis[key]=deps;
 const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\s*$/gm,'');
 const exported=[...code.matchAll(/^export (?:async )?function (\w+)/gm)].map(match=>match[1]);
 const result=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).filter(name=>!exported.includes(name)).join(',')+'}=globalThis.'+key+';\n'+code).toString('base64'));delete globalThis[key];return result;
}
const all=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(all)];
const text=node=>typeof node==='string'||typeof node==='number'?String(node):node&&typeof node==='object'?[node.props?.children].flat(Infinity).map(text).join(''):'';
const button=(tree,label)=>all(tree).find(n=>n.type==='button'&&text(n)===label);
const jsx={_Fragment:'fragment',_jsx:(type,props)=>({type,props}),_jsxs:(type,props)=>({type,props})};
const offer=(id,at,title=id)=>({id,at,title,description:'',ctaLabel:'Sign Up',action:'checkout',url:'',expiresAt:null,durationSeconds:59});
function fixture(){
 const day={...policy.newWebinar('00000000-0000-4000-8000-000000000123'),status:'published',publicCode:'100000',videoUrl:'https://example.test/day.mp4',durationSeconds:1308,pitchAt:1023,offers:[offer('primary',1023)],purchaseNotifications:{enabled:true,startAt:1308,includeRegion:true,intervalSeconds:15}};
 const night={...recordings.createNightRecording(day),videoUrl:'https://example.test/night.mp4',durationSeconds:1657,pitchAt:1355,offers:[offer('primary',1355),offer('last',1595,'LAST CHANCE: Get iCash X for Just $50/Month')]};
 delete night.purchaseNotifications; // Existing saved recordings used a shared setting.
 return {...day,nightEnabled:true,nightVersion:night};
}
async function api(initial){
 let row={config:initial,public_code:100000,parent_webinar_id:null},owner=true,writes=0;
 const settings=policy.settingsSchema.parse({enabled:false,fromEmail:'',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c']});
 class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
 const route=await moduleFor('app/api/webinar/studio/route.ts',{...policy,z,WebinarError,webinarHeaders:{},webinarOrigin:()=>{},webinarOwner:async()=>{if(!owner)throw new WebinarError(403,'Owner only');},webinarBody:req=>req.json(),webinarError:e=>Response.json({error:e.message},{status:e.status??503}),webinarFollowupReadiness:()=>({email:false}),metaReady:()=>false,checkoutPublishableKey:()=>'',fundingMode:()=>'test',db:async(path,method,body)=>{
  if(path.startsWith('icash_webinars?')){if(method==='PATCH'){if(!path.includes('revision=eq.'+row.config.revision))return [];writes++;row={...row,config:body.config};}return [structuredClone(row)];}
  if(path.startsWith('icash_webinar_settings?'))return [{config:settings}];return {};
 }});
 const post=webinar=>route.POST(new Request('https://example.test/api/webinar/studio',{method:'POST',body:JSON.stringify({action:'save',webinar,isNew:false})}));
 return {...route,post,row:()=>row,writes:()=>writes,deny:()=>owner=false};
}
test('Nighttime offer activity saves and reloads against its own duration, with validation and revision checks intact',async()=>{
 const original=fixture(),store=await api(original);
 const edited=recordings.patchRecording(original,'night',{purchaseNotifications:{...original.purchaseNotifications,startAt:1355}});
 const response=await store.post(edited);assert.equal(response.status,200,await response.clone().text());
 const saved=(await (await store.GET()).json()).webinars[0];
 assert.equal(saved.purchaseNotifications.startAt,1308);
 assert.equal(recordings.editingRecording(saved,'night').purchaseNotifications.startAt,1355);
 assert.equal(saved.nightVersion.offers[1].title,'LAST CHANCE: Get iCash X for Just $50/Month');
 assert.equal(policy.webinarSchema.safeParse(saved).success,true);
 assert.equal((await store.post(edited)).status,409,'Stale revisions cannot overwrite another save');
 const bad=recordings.patchRecording(saved,'night',{offers:[offer('bad',1355),{...offer('link',1400),action:'link',url:''}]});
 const invalid=await store.post(bad);assert.equal(invalid.status,400,'External links still require a destination');
 assert.match((await invalid.json()).error,/Nighttime offer 2 destination URL/);
 assert.equal((await store.post(recordings.patchRecording(saved,'night',{purchaseNotifications:{...saved.purchaseNotifications,startAt:1658}}))).status,400);
 assert.equal(store.writes(),1,'Invalid saves leave the stored webinar unchanged');
 store.deny();assert.equal((await store.post(saved)).status,403);
});
test('editing Daytime preserves inherited Nighttime activity and independent viewer settings',()=>{
 const original=fixture();original.durationSeconds=1800;original.purchaseNotifications.startAt=1200;
 const edited=recordings.patchRecording(original,'day',{purchaseNotifications:{...original.purchaseNotifications,startAt:1700}});
 assert.equal(policy.webinarSchema.safeParse(edited).success,true);
 assert.equal(recordings.editingRecording(edited,'night').purchaseNotifications.startAt,1200);
 assert.equal(recordings.selectRecording(edited,'UTC',new Date(),undefined,'night').purchaseNotifications.startAt,1200);
 assert.equal(recordings.selectRecording(edited,'UTC',new Date(),undefined,'day').purchaseNotifications.startAt,1700);
});

const iconNames=['Plus','Upload','Play','Save','Trash2','Video','MessageSquare','Mail','BarChart3','LayoutDashboard','ArrowRight','ArrowLeft','Clock','Sun','Moon','Users','Check','Copy','ExternalLink','ShoppingBag','ArrowUpRight','CheckCircle2','ChevronRight','Eye','RefreshCw','ShoppingCart','CreditCard','Settings2','Sparkles'];
const icons=Object.fromEntries(iconNames.map(n=>[n,n]));
const components=Object.fromEntries(['AccountAccess','WebinarTimeInput','WebinarOffersEditor','WebinarChatModeration','WebinarAudienceEditor','WebinarDashboard','WebinarResults','WebinarReview','WebinarGrowthSettings','WebinarActivityEditor','WebinarOfferImage','WebinarOfferSpots','DateTimeInput','ConversionFunnel'].map(n=>[n,n]));
test('adding an offer starts with a valid destination for main and VIP sessions',async()=>{
 const {WebinarOffersEditor}=await moduleFor('components/webinar-offers-editor.tsx',{...jsx,...icons,...components,...policy});
 for(const initial of [fixture(),policy.newVipWebinar('00000000-0000-4000-8000-000000000456',fixture())]){
  let changed;const tree=WebinarOffersEditor({webinar:initial,onChange:patch=>changed={...initial,...patch}});
  button(tree,'Add offer').props.onClick();
  assert.equal(policy.webinarSchema.safeParse(changed).success,true);
  assert.equal(changed.offers.at(-1).action,policy.webinarOffers(initial).at(-1).action);
  assert.equal(changed.offers.at(-1).url,policy.webinarOffers(initial).at(-1).url);
 }
});
test('new and legacy VIP defaults open upgrade checkout without changing custom links or saved cues',()=>{
 const vip=policy.newVipWebinar('00000000-0000-4000-8000-000000000456',fixture());
 assert.equal(policy.webinarOffers(vip)[0].action,'checkout');
 const legacy={...offer('workspace',800,'Open your workspace'),action:'link',url:'/join?setup=1'};
 const custom={...offer('custom',1100),action:'link',url:'https://example.test/custom'};
 const copied={...legacy,id:'last-chance',title:'Last Chance: Only 1 VIP Spot Left',at:1200};
 vip.offers=[legacy,custom,copied];
 const resolved=policy.webinarOffers(vip);
 assert.equal(resolved[0].action,'checkout');assert.equal(resolved[0].at,800);assert.equal(resolved[0].durationSeconds,59);
 assert.deepEqual(resolved[1],custom);assert.equal(vip.offers[0].action,'link','Reading does not mutate saved configuration');
 assert.equal(resolved[2].action,'checkout');assert.equal(resolved[2].title,copied.title,'Copied VIP setup links become upgrade offers without losing saved headlines');
 assert.equal(policy.webinarOffers({...vip,parentWebinarId:null})[0].action,'link','Main webinar links retain their configured behavior');
});
test('dashboard Edit and title actions retain the Daytime or Nighttime row selection',async()=>{
 const {WebinarDailyDashboard}=await moduleFor('components/webinar-daily-dashboard.tsx',{...jsx,...icons,...components,...policy,...reporting,...links,webinarSite:{brandName:'iCash X'},webinarFunnelStages:[],useState:initial=>[initial,()=>{}],useEffect:()=>{}});
 const selected=[],w=fixture(),tree=WebinarDailyDashboard({webinars:[w],onEdit:(webinar,version)=>selected.push([webinar.id,version])});
 for(const row of all(tree).filter(n=>n.type==='tr'))for(const edit of all(row).filter(n=>n.type==='button'))edit.props.onClick();
 assert.deepEqual(selected,[[w.id,'day'],[w.id,'day'],[w.id,'night'],[w.id,'night']]);
});

test('studio saves Nighttime offers through the API and keeps the same offers after reopening',async()=>{
 globalThis.window={addEventListener(){},removeEventListener(){},confirm:()=>false};
 const store=await api(fixture()),cells=[],effects=[],pending=[];let index=0;
 const vip={...policy.newVipWebinar('00000000-0000-4000-8000-000000000456',fixture()),videoUrl:'https://example.test/vip-day.mp4',nightVersion:fixture().nightVersion};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const deps={...jsx,...icons,...components,...policy,...recordings,...links,webinarSite:{brandName:'iCash X'},useState(initial){const n=index++;if(!(n in cells))cells[n]=typeof initial==='function'?initial():initial;return [cells[n],value=>cells[n]=typeof value==='function'?value(cells[n]):value];},useRef(initial){const n=index++;return cells[n]??={current:initial};},useEffect(fn,list){const n=index++;if(!same(effects[n]?.list,list))pending.push(()=>{effects[n]?.cleanup?.();effects[n]={list,cleanup:fn()};});},webinarRequest:async(_path,options)=>{
  const response=options?.method==='POST'?await store.POST(new Request('https://example.test/api/webinar/studio',options)):await store.GET();
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error),{status:response.status});if(options?.method!=='POST')data.webinars.push(vip);return data;
 }};
 const {WebinarStudio}=await moduleFor('components/webinar-studio.tsx',deps);
 const render=()=>{index=0;const tree=WebinarStudio();while(pending.length)pending.shift()();return tree;};
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 let tree=render();await settle();tree=render();
 const dashboard=all(tree).find(n=>n.type==='WebinarDashboard');
 assert.ok(dashboard.props.webinars.some(w=>w.id===vip.id),'Studio keeps paired VIP sessions available for editing');
 dashboard.props.onEdit(vip,'night');tree=render();
 assert.equal(all(tree).find(n=>n.type==='a'&&text(n)==='Preview saved Nighttime VIP')?.props.href,`/webinar?preview=${vip.id}&variant=night`);
 dashboard.props.onEdit(fixture(),'night');tree=render();
 assert.equal(all(tree).find(n=>n.type==='a'&&text(n)==='Preview saved Nighttime')?.props.href,`/webinar?preview=${fixture().id}&variant=night`);
 assert.equal(all(tree).find(n=>n.type==='button'&&n.props['aria-pressed']&&text(n)==='Nighttime')?.props['aria-pressed'],true);
 button(tree,'2Offers').props.onClick();tree=render();
 const editor=()=>all(tree).find(n=>n.type==='WebinarOffersEditor');
 editor().props.onChange({purchaseNotifications:{...fixture().purchaseNotifications,startAt:1355},offers:[...fixture().nightVersion.offers.slice(0,1),offer('last',1595,'Last chance — saved')]});tree=render();
 assert.ok(text(tree).includes('Save changes to include your latest edits.'));
 button(tree,'Save Nighttime offers').props.onClick();await settle();tree=render();
 assert.equal(store.writes(),1);
 assert.ok(all(tree).some(n=>n.props?.role==='status'&&text(n).includes('Nighttime')));
 const saved=(await (await store.GET()).json()).webinars[0];
 button(tree,'My webinars').props.onClick();tree=render();
 all(tree).find(n=>n.type==='WebinarDashboard').props.onEdit(saved,'night');tree=render();button(tree,'2Offers').props.onClick();tree=render();
 assert.equal(editor().props.webinar.offers[1].title,'Last chance — saved');
 assert.equal(editor().props.webinar.purchaseNotifications.startAt,1355);
 assert.equal(store.row().config.offers[0].title,'primary');
 editor().props.onChange({offers:[{...editor().props.webinar.offers[0],action:'link',url:''}]});tree=render();
 button(tree,'Save Nighttime offers').props.onClick();await settle();tree=render();
 assert.equal(store.writes(),1,'An invalid save cannot overwrite the persisted offers');
 assert.ok(all(tree).some(n=>n.props?.role==='alert'&&text(n).includes('Nighttime offer 1 destination URL')));
 assert.ok(!all(tree).some(n=>n.props?.role==='status'&&text(n).includes('saved')),'A failed save clears an earlier success notice');
 button(tree,'Reload').props.onClick();tree=render();
 assert.equal(editor().props.webinar.offers[0].action,'link','Declining reload preserves the unsaved offer for correction');
 effects.forEach(effect=>effect?.cleanup?.());
});
