import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
let stateIndex=0;
const account={signedIn:true,billingModel:'membership_credits',membershipActive:false,balanceCents:99999,paused:false,identity:{principal:'Fixture'},botSetup:{profile:{displayName:'Fixture Bot'}}};
const component=name=>props=>React.createElement('div',{'data-component':name},props.children);
const mocks={
 react:{...React,useState(initial){return React.useState(stateIndex++===0?{...account}:initial);}},
 'next/image':{__esModule:true,default:component('Image')},
 '@/lib/workspace-status':{workspaceNextAction:()=>({kind:'work'}),workspaceActionDisabled:()=>false},
 '@/lib/workspace-progress':{nextWorkFunding:()=>({needsFunding:false})},
 '@/lib/bot-setup':{setupThemes:{ink:{color:'#111',soft:'#eee'}}}
};
const module={exports:{}};
const source=ts.transpileModule(readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',source)(name=>mocks[name]??(name.startsWith('@/components/')?new Proxy({__esModule:true},{get:(target,key)=>key==='__esModule'?true:component(String(key))}):require(name)),module,module.exports);
function render(){stateIndex=0;return renderToStaticMarkup(React.createElement(module.exports.default));}
let markup=render();assert.match(markup,/Restore access/);assert.match(markup,/MembershipSettings/);
for(const name of ['LiveWorkspace','BotRunBar','FundingCheckout','BudgetSummary','WorkspaceUpdates'])assert(!markup.includes('data-component="'+name+'"'),'Locked workspace must not mount '+name);
assert.match(markup,/Sign out/);assert.match(markup,/SupportLauncher/);
account.membershipActive=true;markup=render();assert.match(markup,/data-component="LiveWorkspace"/);assert.match(markup,/data-component="BotRunBar"/);assert(!markup.includes('subscription-lock'));
console.log('PASS workspace lock: funded but inactive accounts see recovery, not workspace/data components; paid access restores them.');
