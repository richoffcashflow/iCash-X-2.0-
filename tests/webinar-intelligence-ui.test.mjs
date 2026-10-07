import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {jsx as _jsx,jsxs as _jsxs} from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import ts from 'typescript';
import {formatWatchTime} from '../lib/webinar-policy.ts';
import {intelligenceContexts,metaWebinarParameters} from '../lib/webinar-intelligence-report.ts';
let states=[],index=0;
const deps={...Object.fromEntries(['ArrowUpRight','Copy','RefreshCw','Sparkles','Sun','Moon'].map(k=>[k,icons[k]])),_jsx,_jsxs,formatWatchTime,intelligenceContexts,metaWebinarParameters,useEffect:()=>{},useState:initial=>[states[index++]??initial,()=>{}]};
globalThis.__intelligenceUI=deps;
const source=ts.transpileModule(readFileSync(new URL('../components/webinar-intelligence.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .* from .*;$/gm,'');
const {WebinarIntelligence}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__intelligenceUI;\n'+source).toString('base64'));
const report={context:'new:day',ad:'*',enabled:true,metricsAvailable:true,plan:{phase:'learning',winnerKey:null,baselineKey:'one',source:'shared',stoppedKeys:[],newStops:[],shares:[]},arms:[],rows:[],ads:[],comparison:null};
function render(data=null,enabled=true,periods=[]){index=0;states=['new:day','*',data,!data,'','',0,periods];return renderToStaticMarkup(WebinarIntelligence({enabled,busy:false,onToggle:async()=>{}}));}
let html=render();assert.ok(html.includes('Loading'));assert.ok(!html.includes('$0.00'));assert.ok(html.includes('role="switch"'));
html=render(report);assert.ok(html.includes('Publish your first webinar'));assert.ok(html.includes('Collecting data'));assert.ok(html.includes(metaWebinarParameters.replaceAll('&','&amp;')));
const populated={...report,plan:{phase:'optimizing',winnerKey:'one',baselineKey:'two',source:'ad',stoppedKeys:[],newStops:[],shares:[{key:'one',share:.85},{key:'two',share:.15}]},arms:[{key:'one',webinarId:'w1',revision:1,version:'day',title:'Main webinar'},{key:'two',webinarId:'w2',revision:2,version:'day',title:'New challenger'}],rows:[{ad_key:'*',webinar_id:'w1',revision:1,recording_version:'day',visitors:200,mature_visitors:100,buyers:10,revenue_cents:15000,average_watch_seconds:754}],comparison:{holdout_visitors:200,holdout_buyers:10,holdout_value_cents:20000,adaptive_visitors:1000,adaptive_buyers:40,adaptive_value_cents:80000}};
html=render(populated);for(const value of ['85.0%','10.0%','$1.50','12:34','-20.0%','Observed results, not a guaranteed lift','Main webinar','Based on this ad’s purchases'])assert.ok(html.includes(value),value);
assert.ok(!html.includes('>Night</small>'));assert.ok(render(populated,false).includes('Paused'));
const night={...populated,context:'new:night',arms:populated.arms.map(a=>({...a,title:a.key==='one'?'Night winner':a.title,version:'night'}))};
html=render(populated,true,[populated,night]);for(const value of ['Best during the day','Best at night','Main webinar','Night winner','aria-pressed="true"','aria-pressed="false"'])assert.ok(html.includes(value),value);
html=render(populated,true,[populated,{...populated,context:'new:night'}]);assert.ok(html.includes('Day recording until Night is added'));
const stopped={...populated,plan:{...populated.plan,stoppedKeys:['two'],shares:[{key:'one',share:1},{key:'two',share:0}]}};
html=render(stopped);assert.ok(html.includes('Stopped · 0%'));assert.ok(html.includes('1 active · 1 stopped'));assert.ok(html.includes('100.0%'));
assert.ok(!render({...stopped,metricsAvailable:false,rows:[]}).includes('<td>0</td>'),'An analytics outage must not invent zero visitors or purchases');
if(process.env.WEBINAR_INTELLIGENCE_PREVIEW){const css=readFileSync(new URL('../app/webinar/webinar.css',import.meta.url),'utf8');writeFileSync(process.env.WEBINAR_INTELLIGENCE_PREVIEW,`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#111}button,input,select{font:inherit}button{cursor:pointer}${css}</style></head><body class="ws-shell"><main class="ws-main" style="max-width:1280px"><header class="ws-heading"><h1>Webinar Intelligence</h1></header>${html}</main></body></html>`);}
console.log('Intelligence UI passed: loading/empty, accessible toggle, actual payment rate, watch time, negative observed lift, Day fallback and paused state.');
