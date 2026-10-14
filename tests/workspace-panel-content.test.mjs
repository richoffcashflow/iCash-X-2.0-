import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
function component(path,name){const source=readFileSync(new URL(path,import.meta.url),'utf8'),mod={exports:{}};const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',compiled)(require,mod,mod.exports);return mod.exports[name];}
const Messages=component('../components/title-company-messages.tsx','TitleCompanyMessages');
const Status=component('../components/workspace-load-status.tsx','WorkspaceLoadStatus');
const replies=[{id:'old',sender:'Sample Title',subject:'Earlier file update',body_text:'File opened.',received_at:'2026-10-14T15:00:00Z',needs_review:false},{id:'new',sender:'Sample Title',subject:'Documents needed',body_text:'Please review <script>unsafe()</script> and the original message.',received_at:'2026-10-14T18:15:00Z',needs_review:true}];
const original=JSON.stringify(replies),html=renderToStaticMarkup(Messages({replies}));
assert(html.indexOf('Documents needed')<html.indexOf('Earlier file update'),'the latest received message leads even when input is oldest first');
assert.match(html,/View all messages \(2\)/);assert.match(html,/Needs your review/);assert.match(html,/AM|PM/);
assert.match(html,/&lt;script&gt;unsafe\(\)&lt;\/script&gt;/,'message contents remain escaped text');assert.doesNotMatch(html,/<script>/);
assert.equal(JSON.stringify(replies),original,'sorting never mutates API state');
assert.match(renderToStaticMarkup(Messages({replies:[]})),/No title company messages yet/);
assert.match(renderToStaticMarkup(Messages({replies:[{...replies[0],received_at:'invalid'}]})),/Time unavailable/);
const base={label:'closing',loading:false,error:false,hasData:false,updatedAt:null,onRetry:()=>{}};
assert.equal(Status({...base,hasData:true}),null);
assert.match(renderToStaticMarkup(Status({...base,loading:true})),/Loading closing details…/);
assert.match(renderToStaticMarkup(Status({...base,error:true})),/Could not load closing details\./);
const stale=renderToStaticMarkup(Status({...base,error:true,hasData:true,updatedAt:'2026-10-14T18:15:00Z'}));
assert.match(stale,/Showing saved closing details\. Updates could not be refreshed\./);assert.match(stale,/Last updated/);assert.match(stale,/Try again/);
const pending=renderToStaticMarkup(Status({...base,error:true,loading:true}));assert.match(pending,/disabled=""/);assert.match(pending,/Refreshing…/);
let retried=0;const node=Status({...base,label:'buyer',error:true,onRetry:()=>retried++});node.props.children[1].props.onClick();assert.equal(retried,1,'retry performs the explicit callback once');
console.log('Panel contents: newest title reply, full history, safe text, empty messages and loading/error/stale/retry states passed.');
