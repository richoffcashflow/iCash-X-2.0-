import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {propertyContext} from '../lib/property-context.ts';
import * as debt from '../lib/property-debt-view.ts';
import * as analysis from '../lib/property-analysis-view.ts';

const property=propertyContext({data:{dm_property_id:'prop_12346',full_address:'Fixture property',estimated_value:190000,estimated_equity_amount:145000,total_estimated_loan_balance:45000,total_open_lien_amount:45000,has_active_lien:true,is_tax_delinquent:true}},'prop_12346','2026-10-14T15:00:00Z');
const result={property},original=JSON.stringify(result);
const view=debt.propertyDebtView(result);
assert.equal(view.mortgageCents,4500000,'saved mortgage is not added to potentially overlapping lien totals');
assert.equal(view.equityCents,14500000);assert.equal(view.lienStatus,'Reported');assert.equal(view.taxesReported,true);
const saved=screen=>({property:{financialScreening:screen}});
for(const missing of [null,undefined,{},[],{property:null},saved({})]){
 const v=debt.propertyDebtView(missing);assert.equal(v.mortgageCents,null);assert.equal(v.equityCents,null);assert.equal(v.lienStatus,'Not confirmed');
}
for(const invalid of ['4500000',NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1]){
 const v=debt.propertyDebtView(saved({estimatedLoanBalanceCents:invalid,equityCents:invalid}));
 assert.equal(v.mortgageCents,null);assert.equal(v.equityCents,null);
}
assert.equal(debt.propertyDebtView(saved({estimatedLoanBalanceCents:-1})).mortgageCents,null);
assert.equal(debt.propertyDebtView(saved({equityCents:-1000000})).equityCents,-1000000,'negative owner equity remains visible');
assert.equal(debt.propertyDebtView({property:{estimatedEquityCents:1000000,financialScreening:{equityCents:null}}}).equityCents,null,'explicit unknown never falls back to stale equity');
assert.equal(debt.propertyDebtView({property:{estimatedEquityCents:1000000}}).equityCents,1000000,'older normalized equity remains readable');
for(const flag of [{activeLien:true},{hoaLien:true},{activeLiens:1},{openLiens:1},{lienAmountCents:1}])assert.equal(debt.propertyDebtView(saved(flag)).lienStatus,'Reported');
const zero=saved({estimatedLoanBalanceCents:0,equityCents:0,activeLien:false,hoaLien:false,activeLiens:0,openLiens:0,lienAmountCents:0,freeAndClear:true});
assert.equal(debt.propertyDebtView(zero).lienStatus,'Not confirmed','even a free-and-clear provider flag is not verified title');
assert.equal(debt.propertyDebtView(saved({status:'title_review_needed'})).lienStatus,'Needs confirmation');
assert.equal(debt.propertyDebtView(saved({status:'title_review_needed',taxDelinquent:true})).lienStatus,'Not confirmed','unpaid taxes alone do not invent another reported lien');
assert.equal(debt.propertyDebtView(saved({status:'conflicting_data'})).conflicting,true);
assert.equal(debt.propertyDebtView(saved({status:'payoff_may_exceed_budget'})).payoffMayExceedOffer,true);
assert.equal(debt.propertyDebtView({property:{fetchedAt:'bad'}}).fetchedAt,null);

const require=createRequire(import.meta.url),source=readFileSync(new URL('../components/property-debt-summary.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
new Function('require','module','exports',compiled)(name=>name==='@/lib/property-debt-view'?debt:name==='@/lib/property-analysis-view'?analysis:require(name),mod,mod.exports);
const text=node=>typeof node==='string'?node:typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):'';
const render=(result,closing=false)=>text(mod.exports.PropertyDebtSummary({result,closing}));
assert.match(render(result),/Estimated mortgage balance.*\$45,000.*Owner’s estimated equity.*\$145,000.*Liens in property records.*Reported/);
assert.match(render(result),/Unpaid property taxes.*Research from Oct 14, 2026.*closing office confirms actual payoffs and liens/);
assert.doesNotMatch(render(result),/\$90,000|profit|proceeds/i,'the view never treats owner equity as customer earnings');
assert.match(render(result,true),/Mortgage & title.*\$45,000.*Reported/);assert.doesNotMatch(render(result,true),/equity|\$145,000/,'closing only repeats the relevant debt and title information');
assert.match(render(zero),/\$0/);assert.doesNotMatch(render(zero),/clear title|No liens/i);
assert.match(render(null),/Not available/);assert.doesNotMatch(render(null),/\$0/);
assert.match(render(saved({equityCents:-1000000})),/-\$10,000/);
assert.match(render(saved({status:'conflicting_data'})),/Property records disagree/);
assert.match(render(saved({status:'payoff_may_exceed_budget'})),/saved offer limit/);
assert.equal(JSON.stringify(result),original,'presentation never overwrites research');
assert.doesNotMatch(source,/\bfetch\s*\(|onClick|onSubmit/,'the summary makes no provider calls or writes');
console.log('Mortgage and title summary: saved values, overlapping debt, unknown/zero/negative equity, lien flags, dates and concise closing display passed.');
