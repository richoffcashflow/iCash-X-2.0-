import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {supportQualityReport,collectSupportQuality} from '../lib/support-quality.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const now=new Date('2026-10-30T20:00:00Z'),old='2026-10-28T12:00:00Z';
const message=(role,content,minute)=>({role,content,created_at:`2026-10-30T19:${String(minute).padStart(2,'0')}:00Z`});
const conversation=(messages,extra={})=>({id:randomUUID(),kind:'account',subject:'Help',status:'open',updated_at:now.toISOString(),messages,...extra});
const repeated=conversation([message('user','Does the contact show up the same time as the lead?',1),message('assistant','You don’t need to add listings or upload properties.',2),message('user','Does the contact show up the same time as the lead?',3),message('assistant','You don’t need to add listings or upload properties.',4)]);
const empty=conversation([message('user','My original icashx stopped working',1),message('assistant','Please don’t share the code itself.',2)],{kind:'access'});
const resolved=conversation([message('user','Where is Course?',1),message('assistant','Open Course in your workspace.',2)],{status:'resolved',updated_at:old});
const corrected=conversation([...repeated.messages,message('operator','A lead may appear before contact details are available.',5)]);
const oldCase=conversation([message('user','My bot is not calling',1)],{updated_at:old});
let report=supportQualityReport([repeated,empty,resolved,corrected,oldCase],now);
assert.equal(report.sampled,5);assert.equal(report.flagged,3);assert.equal(report.needsReview,3);
assert.deepEqual(report.cases.find(c=>c.id===repeated.id).flags.map(f=>f.code),['repeat','mismatch']);
assert.equal(report.cases.some(c=>c.id===corrected.id),false,'Operator correction supersedes an old automatic failure');
assert.equal(report.cases.some(c=>c.id===resolved.id),false,'A resolved case is not stalled');
assert.deepEqual(report.cases.find(c=>c.id===oldCase.id).flags.map(f=>f.code),['stalled']);
assert.equal(report.topics.reduce((n,t)=>n+t.conversations,0),5);
const clarification=conversation([message('user','Something about my page is confusing.',1),message('assistant','I don’t have a confirmed answer yet. Which page are you on?',2)]);
assert.equal(supportQualityReport([clarification],now).flagged,0,'A useful first clarification is not an empty reply');
const privateCase=conversation([message('user','My code is for someone@example.invalid. https://evil.invalid/ <script>alert(1)</script>',1),message('assistant','Please don’t share the code itself.',2)]);
const sanitized=supportQualityReport([privateCase],now).cases[0];assert.doesNotMatch(sanitized.question,/someone@|https:\/\//);

// Real collector bodies: bounded, read-only, scoped to the selected case IDs.
const paths=[];
const db=async(path,method,body)=>{
 assert.equal(method,undefined);assert.equal(body,undefined);paths.push(path);
 if(path.startsWith('icash_support_threads?'))return [repeated];
 if(path.startsWith('icash_access_help_requests?'))return [empty];
 if(path.startsWith('icash_support_messages?'))return [...repeated.messages.map(m=>({...m,thread_id:repeated.id})),{...message('assistant','Foreign case text',6),thread_id:randomUUID()}];
 if(path.startsWith('icash_access_help_messages?'))return empty.messages.map(m=>({...m,request_id:empty.id}));
 assert.fail('Unexpected query');
};
report=await collectSupportQuality(db,now);assert.equal(report.flagged,2);assert.equal(paths.length,4);
assert(paths[0].includes('limit=61')&&paths[1].includes('limit=41'));assert(paths[2].includes('limit=600')&&paths[3].includes('limit=400'));
assert(paths[2].includes('thread_id=in.('+repeated.id+')'));assert.doesNotMatch(JSON.stringify(report),/Foreign case text/);
const limited=await collectSupportQuality(async path=>path.startsWith('icash_support_threads?')?Array.from({length:61},()=>({...repeated,id:randomUUID()})):[],now);assert.equal(limited.sampled,60);assert.equal(limited.limited,true);
await assert.rejects(()=>collectSupportQuality(async path=>path.startsWith('icash_support_threads?')?[{...repeated,id:'bad),or=(true'}]:[],now),/Invalid conversation/);

let authorized=false,reads=0,broken=false;
const route=await loadService('app/api/support/admin/quality/route.ts',{requireTrustedOperator:async()=>{if(!authorized)throw Error('OPERATOR_REQUIRED');},db,collectSupportQuality:async()=>{reads++;if(broken)throw Error('Unavailable');return report;}});
assert.equal((await route.GET()).status,403);assert.equal(reads,0);
authorized=true;let response=await route.GET();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal((await response.json()).sampled,2);
broken=true;response=await route.GET();assert.equal(response.status,503);assert.equal((await response.json()).sampled,undefined,'A failed review is never shown as zero issues');

// Render the actual review panel and exercise the conversation-open control.
let selected=null,index=0;const states=[{...report,cases:[sanitized]},false,'','all'];
globalThis.__qualityPanel={React,useCallback:f=>f,useEffect:()=>{},useRef:v=>({current:v}),useState:()=>[states[index++],()=>{}],supportRequest:async()=>{throw Error('No transport during render');}};
const source=ts.transpileModule(readFileSync(new URL('../components/support-quality-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText.replace(/^import .*;\s*$/gm,'');
const {SupportQualityPanel}=await import('data:text/javascript;base64,'+Buffer.from('const {React,useCallback,useEffect,useRef,useState,supportRequest}=globalThis.__qualityPanel;'+source).toString('base64'));
const tree=SupportQualityPanel({onOpen:value=>{selected=value;},onDenied:()=>{}});
const markup=renderToStaticMarkup(tree);assert.match(markup,/Support quality/);assert.match(markup,/Review conversation/);assert.doesNotMatch(markup,/<script>/);
const elements=node=>!node||typeof node!=='object'?[]:[node,...React.Children.toArray(node.props?.children).flatMap(elements)];
elements(tree).find(n=>n.type==='button'&&n.props.children==='Review conversation').props.onClick();assert.equal(selected.id,privateCase.id);
console.log('PASS support quality: real reply signals, operator corrections, honest sample bounds, redacted previews, operator-only read routes, failure handling and review navigation. No writes or sends.');
