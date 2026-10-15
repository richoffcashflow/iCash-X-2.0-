import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {provisionalVoiceUsageDisclosure} from '../lib/provisional-voice-usage-disclosure.ts';

for(const value of [undefined,null,false,0,1,'true','usage-meter:voice:fixture',{},[],{pending:true}]){
 assert.equal(provisionalVoiceUsageDisclosure(value),null,'Only an exact server-confirmed pending signal shows the notice');
}
assert.equal(provisionalVoiceUsageDisclosure(true,true),null,'Do not display stale account metadata');
const notice=provisionalVoiceUsageDisclosure(true);
assert.match(notice,/awaiting final receipts/);
assert.match(notice,/Provisional deductions are estimates, not final charges/);
assert.match(notice,/call’s original rates/);
assert.match(notice,/only the difference is deducted or returned/);
assert(!/\$|per minute|provider|hold|guarantee|completed usage/i.test(notice));
const component=readFileSync(new URL('../components/provisional-voice-usage-disclosure.tsx',import.meta.url),'utf8');
assert.match(component,/if\(!message\)return null/);
assert.match(component,/aria-label="Provisional call usage"/);
assert(!/fetch\(|useEffect|setInterval|role="alert"/.test(component),'The disclosure introduces no requests, timers, or repeated alerts');
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
assert.match(page,/<ProvisionalVoiceUsageDisclosure pending=\{account\.provisionalVoiceUsage\} stale=\{accountError\}\/>/);
assert(page.indexOf('<ProvisionalVoiceUsageDisclosure')>page.indexOf('<BotRunBar'),'The notice follows the existing wallet controls');
const require=createRequire(import.meta.url),module={};
const compiled=ts.transpileModule(component,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
new Function('require','exports',compiled)(name=>name==='@/lib/provisional-voice-usage-disclosure'?{provisionalVoiceUsageDisclosure}:name.endsWith('.module.css')?{notice:'notice'}:require(name),module);
const render=props=>renderToStaticMarkup(createElement(module.ProvisionalVoiceUsageDisclosure,props));
for(const props of [{},{pending:false},{pending:true,stale:true}])assert.equal(render(props),'');
const markup=render({pending:true});
assert.match(markup,/<aside class="notice" aria-label="Provisional call usage">/);
assert.match(markup,/Provisional deductions are estimates, not final charges/);
assert.equal((markup.match(/<aside/g)||[]).length,1);
assert(!/<button|<a\s|<input|<script|<form/.test(markup),'Disclosure has no action or payment controls');
assert.equal(render({pending:false}),'','Completed or unmetered account has no added DOM');
console.log('PASS provisional usage display: actual component server render, exact pending signal, hidden stale/unmetered states, original call rates and difference-only reconciliation.');
