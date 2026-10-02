import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {safeLocalTime,propertyAddressLines,propertyResearchDate} from '../components/workspace-view.ts';
const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../components/live-workspace.tsx',import.meta.url),'utf8')+'\nexport {PurchasedContacts,PropertyCard};',{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
new Function('require','module','exports',code)(name=>name==='react'?{useState:v=>[v,()=>{}],useEffect(){},Activity:'Activity'}:name==='react/jsx-runtime'?require(name):name==='./workspace-view'?{safeLocalTime,propertyAddressLines,propertyResearchDate,needsAttention:()=>false}:name==='@/lib/work-milestone'?{workMilestone:()=> 'Research received'}:{},mod,mod.exports);
const lookup={screening_id:'owned',created_at:'2026-10-01T01:02:03Z',fetchedAt:'2026-10-01T01:01:02Z',source:'DealMachine',ownershipVerified:false,outreachAuthorized:false,contacts:[
 {name:'Synthetic Person',phones:[{number:'+12025550101',type:'Mobile',doNotCall:true},{number:'+12025550102',type:'Landline',doNotCall:false},{number:'+12025550103',type:null,doNotCall:null},{number:null,type:null}]},
 {name:null,phones:[]}
]};
const render=lookup=>renderToStaticMarkup(mod.exports.PurchasedContacts({lookup}));
let html=render(lookup);
for(const content of ['Purchased contact lookup','Synthetic Person','+12025550101','Mobile','+12025550102','Landline','Source: DealMachine',safeLocalTime(lookup.fetchedAt),'Ownership unverified','Outreach permission unverified','Source DNC flags are not legal clearance to call or text','Source DNC: flagged. Do not contact.','Source DNC: not flagged. Outreach permission remains unverified.','Source DNC: unknown. Outreach permission remains unverified.','Name unavailable','Phone number unavailable','Phone type unavailable','No phone numbers returned.'])assert.ok(html.includes(content),content);
assert.doesNotMatch(html,/<button|<form|href=|tel:|mailto:|eligible to contact|cleared/i,'Lookup is a read-only research display');
html=render({screening_id:'legacy'});assert.match(html,/Source unavailable/);assert.match(html,/Lookup time unavailable/);assert.match(html,/No contact details returned/);assert.match(html,/Ownership unverified/);
html=render({...lookup,fetchedAt:null,contacts:[]});assert.ok(html.includes('Lookup recorded '+safeLocalTime(lookup.created_at)));assert.match(html,/No contact details returned/);
html=render({...lookup,contacts:[{name:'<script>synthetic</script>',phones:[{number:'<img src=x>',type:'<script>',doNotCall:false}]}]});assert.doesNotMatch(html,/<script>|<img /);assert.match(html,/&lt;script&gt;/);
const all=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(all):[root,...all(root.props?.children)];
const property={id:'owned',completed_at:'2026-10-01T01:00:00Z',result:{property:{propertyId:'prop_1',address:'1 Synthetic Street'},financialCheck:{status:'eligible',reason:'Synthetic'},preliminarySellerCeilingCents:null}};
const work={controls:[],deals:[],conversations:[],handoffs:[],callRequests:[],callbacks:[],signing:[],contacts:[lookup,{...lookup,screening_id:'other',contacts:[{name:'Other property contact',phones:[]}]}]};
const card=mod.exports.PropertyCard({property,work,principal:'',active:true,visited:true,hidden:false,onToggle(){},onRefresh(){}});
const displayed=all(card).filter(node=>node.type===mod.exports.PurchasedContacts);assert.equal(displayed.length,1);assert.equal(displayed[0].props.lookup,lookup,'Property cards select only their own lookup when retained views merge multiple properties');
assert.equal(all(card).find(node=>node.type==='Activity').props.mode,'visible');
console.log('Purchased contact display: actual component renders names, phones, source/timing, all DNC states and missing fields; preserves unverified permissions, escapes text, exposes no outreach controls, and isolates retained property cards. Synthetic fixtures only.');
