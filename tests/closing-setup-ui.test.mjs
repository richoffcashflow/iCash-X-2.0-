import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as policy from '../lib/closing-setup.ts';
const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../components/closing-setup.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const view={setup:null,verifiedContact:null,directory:[],buyerSuggestions:[],titleEmailInAgreement:null};
function render(editing,payout={payeeName:'Fixture LLC',payeeType:'company',method:'wire',mailingAddress:'',detailsSharedWithTitle:false}){
 let index=0;const mod={exports:{}};
 new Function('require','module','exports',code)(name=>name==='react'?{useState:initial=>{const current=index++;return [current===0?payout:current===2?editing:initial,()=>{}];}}:name==='@/lib/closing-setup'?policy:require(name),mod,mod.exports);
 return renderToStaticMarkup(mod.exports.ClosingSetup({dealId:'fixture',view,onSaved(){}}));
}
let html=render('payout');
assert.match(html,/Legal payee name/);assert.match(html,/Company \/ LLC/);assert.match(html,/Do not enter bank numbers here/);
assert.match(html,/entity documents/);assert(!/name="(?:accountNumber|routingNumber|ssn)"/.test(html));
html=render('payout',{payeeName:'Fixture LLC',payeeType:'company',method:'check_mail',mailingAddress:'100 Fixture Lane',detailsSharedWithTitle:false});
assert.match(html,/Check mailing address/);assert.match(html,/100 Fixture Lane/);
html=render('title');assert.match(html,/Title company/);assert.match(html,/company name is enough/i);assert.match(html,/Independently checked company phone/);
assert.match(render(null),/No current title candidate covers/);
console.log('Closing controls: check address, secure wire handoff, company documents, title preference and honest coverage state render correctly.');
