import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
globalThis.__reminderReact=React;
const source=ts.transpileModule(readFileSync(new URL('../components/webinar-reminder-results.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const {WebinarReminderResults}=await import('data:text/javascript;base64,'+Buffer.from('const React=globalThis.__reminderReact;\n'+source).toString('base64'));
const metrics={channel:'all',deliveredMessages:42,deliveredPeople:21,queuedMessages:12,linkOpens:14,clickedPeople:8,returnedPeople:5,checkoutPeople:3,purchases:2,buyers:2,membershipPurchases:2,vipPurchases:0,revenueCents:10000};
const results={trackingSince:'2026-10-18T19:00:00Z',overall:metrics,channels:[{...metrics,channel:'sms',purchases:1,revenueCents:5000},{...metrics,channel:'email',purchases:1,revenueCents:5000}],jobs:[]};
const markup=renderToStaticMarkup(React.createElement(WebinarReminderResults,{results}));
assert.match(markup,/Are reminders working\?/);assert.match(markup,/\$100\.00/);assert.match(markup,/earlier clicks are unknown/);assert.match(markup,/seven days/);assert.match(markup,/Renewals, work credits, test payments/);assert.match(markup,/8<\/dd>/);assert.match(markup,/AM|PM/);
const unavailable=renderToStaticMarkup(React.createElement(WebinarReminderResults,{results:null}));assert.match(unavailable,/temporarily unavailable/);assert.doesNotMatch(unavailable,/\$0|>0</,'Unavailable analytics is never shown as a zero-performance result');
if(process.env.REMINDER_UI_PREVIEW){const css=readFileSync(new URL('../components/campaign-sequence.css',import.meta.url),'utf8');writeFileSync(process.env.REMINDER_UI_PREVIEW,`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial,sans-serif;margin:20px;color:#111;background:#fff}main{max-width:900px;margin:auto}*{box-sizing:border-box}${css}</style><main class="ms-sequence">${markup}</main></html>`);}
console.log('PASS reminder results: readable combined/channel totals, explicit tracking start, deduplication rules, verified revenue and unavailable-versus-zero distinction.');
