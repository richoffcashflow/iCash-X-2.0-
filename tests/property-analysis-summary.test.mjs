import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {propertyContext} from '../lib/property-context.ts';
import * as analysis from '../lib/property-analysis-view.ts';

const fetchedAt='2026-10-01T12:00:00Z';
const property=propertyContext({data:{dm_property_id:'prop_12345',full_address:'Fixture property',estimated_value:200000,estimated_repair_cost:40000,building_condition:'Average'}},'prop_12345',fetchedAt);
const result={property,preliminarySellerCeilingCents:9000000};
let view=analysis.propertyAnalysisView(result);
assert.equal(view.cashOfferCeilingCents,9000000);
assert.equal(view.arvCents,20000000);
assert.equal(view.repairs.baselineCents,4000000);
assert.equal(view.repairs.status,'baseline');
assert.equal(view.source,'DealMachine');
assert.equal(view.fetchedAt,'2026-10-01T12:00:00.000Z');
assert.equal(view.comparableSalesStatus,'not_recorded');
assert.equal(analysis.analysisMoney(0),'$0');
assert.equal(analysis.analysisMoney(123456),'$1,234.56');
assert.equal(analysis.analysisMoney(null),'Not available');

for(const missing of [null,undefined,{},[],{property:null}]){
 view=analysis.propertyAnalysisView(missing);
 assert.equal(view.cashOfferCeilingCents,null);assert.equal(view.arvCents,null);
 assert.equal(view.repairs.status,'missing');
}
for(const invalid of ['9000000',NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
 view=analysis.propertyAnalysisView({preliminarySellerCeilingCents:invalid,property:{arvEstimate:{cents:invalid},repairs:{baselineCents:invalid}}});
 assert.equal(view.cashOfferCeilingCents,null);assert.equal(view.arvCents,null);assert.equal(view.repairs.baselineCents,null);
}
view=analysis.propertyAnalysisView({property:{arvEstimate:{cents:null},estimatedMarketValueCents:12345,fetchedAt:'bad'}});
assert.equal(view.arvCents,null,'an explicit missing estimate never falls back to a different saved value');assert.equal(view.fetchedAt,null);
assert.equal(analysis.propertyAnalysisView({property:{estimatedMarketValueCents:100}}).arvCents,100,'older normalized market value remains available');
const withRepairs=repairs=>analysis.propertyAnalysisView({property:{repairs}}).repairs;
assert.deepEqual(withRepairs({baselineCents:400,rangeCents:{low:300,high:500},rangeStatus:'available'}).rangeCents,{low:300,high:500});
assert.equal(withRepairs({baselineCents:0}).status,'baseline','recorded zero is not missing');
for(const range of [{low:500,high:300},{low:300,high:350},{low:'300',high:500},{low:300,high:Infinity}]){
 const repairs=withRepairs({baselineCents:400,rangeCents:range,rangeStatus:'available'});
 assert.equal(repairs.status,'invalid');assert.equal(repairs.rangeCents,null);assert.equal(repairs.baselineCents,400);
}
assert.equal(withRepairs({baselineCents:400,rangeCents:{low:300,high:500},rangeStatus:'invalid'}).rangeCents,null);
assert.equal(analysis.propertyAnalysisView({...result,comps:[{price:200000}],property:{...property,comparables:[{estimated_value:200000}]}}).comparableSalesStatus,'not_recorded','unverified loose provider arrays are not reported as actual sales');

const require=createRequire(import.meta.url),source=readFileSync(new URL('../components/property-analysis-summary.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
new Function('require','module','exports',compiled)(name=>name==='@/lib/property-analysis-view'?analysis:require(name),mod,mod.exports);
const text=node=>typeof node==='string'?node:typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):'';
let rendered=text(mod.exports.PropertyAnalysisSummary({result}));
assert.match(rendered,/Estimated cash offer.*\$90,000/);
assert.match(rendered,/Estimated repairs.*\$40,000/);
assert.match(rendered,/Value after repairs \(ARV\).*\$200,000/);
assert.match(rendered,/not a sent, agreed or approved offer/);
assert.match(rendered,/have not verified what this home would sell for after repairs/);
assert.match(rendered,/DealMachine/);assert.match(rendered,/Oct 1, 2026/);
assert.match(rendered,/Nearby sold homes \(comps\).*Not recorded/);
rendered=text(mod.exports.PropertyAnalysisSummary({result:null}));
assert.doesNotMatch(rendered,/\$0/,'missing estimates are never fabricated zeroes');
assert.match(rendered,/Not available/);
assert.doesNotMatch(source,/\bfetch\s*\(/,'presentation must never initiate a paid lookup');
console.log('Property analysis summary: saved cash ceiling, repairs, ARV provenance, invalid/missing values and honest unavailable comps passed.');
