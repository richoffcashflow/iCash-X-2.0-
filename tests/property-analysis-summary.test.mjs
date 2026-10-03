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
 assert.equal(repairs.status,'baseline');assert.equal(repairs.rangeCents,null);assert.equal(repairs.baselineCents,400);
}
assert.equal(withRepairs({baselineCents:400,rangeCents:{low:300,high:500},rangeStatus:'invalid'}).rangeCents,null);
assert.equal(analysis.propertyAnalysisView({...result,comps:[{price:200000}],property:{...property,comparables:[{estimated_value:200000}]}}).comparableSalesStatus,'not_recorded','unverified loose provider arrays are not reported as actual sales');

const require=createRequire(import.meta.url),source=readFileSync(new URL('../components/property-analysis-summary.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
new Function('require','module','exports',compiled)(name=>name==='@/lib/property-analysis-view'?analysis:require(name),mod,mod.exports);
const text=node=>typeof node==='string'?node:typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):'';
let rendered=text(mod.exports.PropertyAnalysisSummary({result:{...result,calculationVersion:'provider_repair_scalar_v1'}}));
assert.match(rendered,/Cash offer estimate.*\$90,000/);
assert.match(rendered,/Estimated repairs.*\$40,000/);
assert.match(rendered,/Value after repairs.*\$200,000/);
assert.match(rendered,/not an approved offer or an inspection/);
assert.match(rendered,/has not been verified/);
assert.doesNotMatch(rendered,/DealMachine/i);assert.match(rendered,/Oct 1, 2026/);
assert.match(rendered,/No verified nearby sales are saved/);
rendered=text(mod.exports.PropertyAnalysisSummary({result:null}));
assert.doesNotMatch(rendered,/\$0/,'missing estimates are never fabricated zeroes');
assert.match(rendered,/Not available/);
assert.doesNotMatch(source,/\bfetch\s*\(/,'presentation must never initiate a paid lookup');
console.log('Property analysis summary: saved cash ceiling, repairs, ARV provenance, invalid/missing values and honest unavailable comps passed.');

assert.equal(analysis.propertyAnalysisView({property:{repairs:{rangeCents:{low:100,high:900}}}}).repairs.baselineCents,null,'a range never supplies a missing scalar');
assert.equal(analysis.propertyAnalysisView({property:{repairs:{baselineCents:0}}}).repairs.baselineCents,0);
assert.doesNotMatch(source,/repairs\.rangeCents/,'the visible estimate never displays a range');

const all=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(all):[node,...all(node.props?.children)];
const offerMetric=saved=>all(mod.exports.PropertyAnalysisSummary({result:saved})).find(n=>n.props?.className==='property-analysis-metric property-analysis-offer');
const original=JSON.stringify(result);
for(const calculationVersion of [undefined,null,'legacy_range_v0','unknown_future_version']){
 const saved={...result,calculationVersion};
 const metric=offerMetric(saved);
 assert.equal(metric.props['data-earlier-estimate'],true);
 assert.match(text(metric),/Earlier saved estimate · Needs update.*\$90,000.*Unapproved ·\s+Recorded Oct 1, 2026/,'legacy amount and its limitations are visible outside collapsed details');
 assert.doesNotMatch(text(metric),/Cash offer estimate/,'a legacy amount is never labeled as a current cash offer');
 assert.equal(analysis.propertyAnalysisView(saved).offerNeedsUpdate,true,'presentation keeps the calculation-version guard');
}
assert.equal(JSON.stringify(result),original,'display must not overwrite saved research');
assert.match(text(mod.exports.PropertyAnalysisSummary({result})),/earlier saved offer estimate.*No new offer has been calculated or approved/);
assert.equal(analysis.propertyAnalysisView({...result,calculationVersion:'provider_repair_scalar_v1'}).offerNeedsUpdate,false);
const current=text(offerMetric({...result,calculationVersion:'provider_repair_scalar_v1'}));
assert.match(current,/Cash offer estimate.*\$90,000/);assert.doesNotMatch(current,/Earlier saved estimate|Needs update/,'current-version presentation stays distinct without claiming fresh research');
for(const fetchedAt of [undefined,null,'bad']){
 const metric=text(offerMetric({...result,property:{...property,fetchedAt}}));
 assert.match(metric,/Earlier saved estimate.*\$90,000.*Unapproved ·\s+Recorded date unavailable/);
 assert.doesNotMatch(metric,/Invalid Date|Recorded Oct/,'a missing date is not replaced by today or another saved timestamp');
}
assert.match(text(offerMetric({...result,property:{...property,fetchedAt:'2026-10-01T23:30:00-07:00'}})),/Recorded Oct 2, 2026/,'recorded dates use UTC consistently');
assert.match(text(offerMetric({...result,preliminarySellerCeilingCents:0})),/Earlier saved estimate.*\$0.*Unapproved/,'a recorded zero remains different from an unavailable amount');
for(const amount of [null,undefined,-1,1.5,'410000',NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
 const metric=text(offerMetric({...result,preliminarySellerCeilingCents:amount}));
 assert.match(metric,/Not available/);assert.doesNotMatch(metric,/Earlier saved estimate|\$/,'invalid or missing saved amounts are never reconstructed from ARV or repairs');
}
assert.doesNotMatch(source,/runScreeningJob|calculateHouseOffer|onClick|onSubmit/,'the financial summary adds no calculation or action');
console.log('Historical-offer presentation: visible saved amount, update/unapproved/date labels, exact version guard, UTC dates, malformed/missing values and no calculation or mutation passed.');

assert.equal(offerMetric({...result,calculationVersion:'provider_repair_scalar_v1'}).props['data-earlier-estimate'],undefined,'historical styling never changes current-version estimates');
const styles=readFileSync(new URL('../app/workspace-clarity.css',import.meta.url),'utf8');
assert.match(styles,/\.property-analysis-offer\[data-earlier-estimate=true\] :is\(dt,dd,small\)\{color:#475467\}/,'historical limitations use high-contrast text');
assert.match(styles,/\.property-analysis-offer\[data-earlier-estimate=true\]\{background:#f5f6f8\}/,'historical amount keeps a neutral treatment');
