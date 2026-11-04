import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import ts from 'typescript';
import {overviewMoney} from '../lib/owner-overview.ts';

const require=createRequire(import.meta.url),mod={exports:{}};
const code=ts.transpileModule(readFileSync(new URL('../app/admin/deal-outcomes.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',code)(name=>name==='@/lib/owner-overview'?{overviewMoney}:name.endsWith('.css')?{default:{}}:require(name),mod,mod.exports);
const zero={signingStarted:0,awaitingSeller:0,awaitingCustomer:0,needsReview:0,verifiedPurchases:0,verifiedAssignments:0,verifiedClosings:0,receivedDeals:0,receivedCents:0};
const data={days:30,startAt:'2026-10-01T05:00:00Z',endAt:'2026-10-30T20:00:00Z',maxDeals:10000,truncated:false,cohorts:[{key:'customers',...zero},{key:'owner',...zero,signingStarted:3,verifiedPurchases:2,verifiedAssignments:1,verifiedClosings:1,receivedDeals:1,receivedCents:1000000}]};
const render=value=>renderToStaticMarkup(createElement(mod.exports.DealOutcomesView,{data:value}));
let html=render(data);assert.match(html,/Customers<\/th><th scope="col">Your account/);assert.match(html,/Verified purchase contracts<\/th><td>0<\/td><td>2<\/td>/);assert.match(html,/Proceeds received<\/th><td>\$0.00<\/td><td>\$10,000.00/);assert.match(html,/Customer results always exclude your account/);assert.match(html,/Your account can include live demonstrations/);assert.doesNotMatch(html,/partial totals/);
assert.match(render({...data,truncated:true}),/partial totals; choose a shorter period/);
html=render(null);assert.match(html,/Deal outcome evidence is unavailable/);assert.doesNotMatch(html,/\$0.00|<table/,'Unavailable evidence never becomes zero customer outcomes');
console.log('PASS operator outcome rendering: owner successes stay separate, unavailable stays unknown, truncation and cohort meaning visible.');
