import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {dashboardReturnPath} from '../lib/dashboard-paths.ts';

const previous={NODE_ENV:process.env.NODE_ENV,VERCEL_ENV:process.env.VERCEL_ENV};
let user=null,error=null,reads=0;
const deps={
 dashboardCurrentUser:async()=>{reads++;if(error)throw error;return user;},
 ownerInboundTarget:{ownerUserId:'owner'},
 redirect:path=>{throw Error('REDIRECT:'+path);},notFound:()=>{throw Error('NOT_FOUND');},
 WorkspacePreview:()=>null,_jsx:(type,props)=>({type,props}),
};
globalThis.__coursePreviewAccess=deps;
const source=ts.transpileModule(readFileSync(new URL('../app/preview/workspace/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .* from .*;$/gm,'');
const page=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__coursePreviewAccess;\n'+source).toString('base64'));
try{
 process.env.NODE_ENV='production';process.env.VERCEL_ENV='production';
 await assert.rejects(page.default(),/REDIRECT:\/dashboard-unlock\?next=%2Fpreview%2Fworkspace/);
 user={id:'customer'};await assert.rejects(page.default(),/NOT_FOUND/);
 user={id:'owner'};error=Error('DASHBOARD_PASSWORD_REQUIRED');await assert.rejects(page.default(),/REDIRECT:/);
 error=Error('Authentication unavailable');await assert.rejects(page.default(),/Authentication unavailable/);
 error=null;assert.equal((await page.default()).type,deps.WorkspacePreview);
 const before=reads;user=null;error=Error('No live auth in fixtures');process.env.VERCEL_ENV='preview';
 assert.equal((await page.default()).type,deps.WorkspacePreview);assert.equal(reads,before);
 delete process.env.VERCEL_ENV;process.env.NODE_ENV='development';
 assert.equal((await page.default()).type,deps.WorkspacePreview);assert.equal(reads,before);
 assert.equal(dashboardReturnPath('/preview/workspace?stage=deposit'),'/preview/workspace?stage=deposit');
 for(const path of ['/preview/workspace/other','//example.invalid/preview/workspace','https://example.invalid/preview/workspace'])assert.equal(dashboardReturnPath(path),'/admin');
 console.log('PASS course preview access: verified owner and dashboard proof in production, fixture isolation, auth-failure propagation, and bounded return path.');
}finally{
 for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 delete globalThis.__coursePreviewAccess;
}
