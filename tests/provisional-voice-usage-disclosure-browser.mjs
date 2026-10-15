// Isolated rendering of the real disclosure component, not a full workspace
// end-to-end test. Local synthetic data only; every network request is blocked.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium} from 'playwright';
import ts from 'typescript';
import {provisionalVoiceUsageDisclosure} from '../lib/provisional-voice-usage-disclosure.ts';

const require=createRequire(import.meta.url),module={};
const component=readFileSync(new URL('../components/provisional-voice-usage-disclosure.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(component,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
new Function('require','exports',compiled)(name=>name==='@/lib/provisional-voice-usage-disclosure'?{provisionalVoiceUsageDisclosure}:name.endsWith('.module.css')?{notice:'notice'}:require(name),module);
const css=readFileSync(new URL('../components/provisional-voice-usage-disclosure.module.css',import.meta.url),'utf8');
const html=props=>`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local provisional usage fixture</title><style>body{margin:0;background:#fff;font-family:Arial,sans-serif}main{max-width:1100px;margin:24px auto;padding:0 20px}${css}</style><main>${renderToStaticMarkup(createElement(module.ProvisionalVoiceUsageDisclosure,props))}</main></html>`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
try{
 for(const [name,width] of [['desktop',1280],['mobile',390]]){
  const page=await browser.newPage({viewport:{width,height:650}});let externalRequests=0;
  await page.route('**/*',route=>{externalRequests++;return route.abort();});
  for(const props of [{},{pending:false},{pending:true,stale:true}]){
   await page.setContent(html(props));assert.equal(await page.getByRole('complementary',{name:'Provisional call usage'}).count(),0);
  }
  await page.setContent(html({pending:true}));
  const notice=page.getByRole('complementary',{name:'Provisional call usage'});
  await notice.waitFor({state:'visible'});
  assert.match(await notice.innerText(),/Provisional deductions are estimates, not final charges/);
  assert.equal(await notice.locator('button,a,input,select,textarea,[tabindex]').count(),0);
  const metrics=await notice.evaluate(el=>({color:getComputedStyle(el).color,overflow:document.documentElement.scrollWidth>innerWidth,rect:el.getBoundingClientRect().toJSON()}));
  assert.equal(metrics.color,'rgb(51, 51, 51)');assert.equal(metrics.overflow,false);
  assert(metrics.rect.x>=0&&metrics.rect.right<=width&&metrics.rect.height<250);
  await page.screenshot({path:`/tmp/icash-provisional-disclosure-${name}.png`,fullPage:true});
  await page.setContent(html({pending:false}));assert.equal(await notice.count(),0,'Final reconciliation removes the notice');
  await page.setContent(html({pending:true}));assert.equal(await notice.count(),1,'Repeated pending render has a single notice');
  assert.equal(externalRequests,0);
  await page.close();
  console.log(`PASS ${name}: real disclosure component, pending/stale/settled render transitions, neutral colors, no horizontal overflow or external requests.`);
 }
}finally{await browser.close();}
