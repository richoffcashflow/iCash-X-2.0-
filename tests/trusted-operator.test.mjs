import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
let user={id:'fixture'},member={expires_at:new Date(Date.now()+86400000).toISOString(),revoked_at:null,scopes:['support']},calls=[];
const mocks={currentUser:async()=>user,db:async path=>{calls.push(path);return member?[member]:[];}};
globalThis.__trustedOperator=mocks;
let source=ts.transpileModule(readFileSync(new URL('../lib/trusted-operator.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {requireTrustedOperator}=await import('data:text/javascript;base64,'+Buffer.from('const {currentUser,db}=globalThis.__trustedOperator;\n'+source).toString('base64'));
assert.deepEqual(await requireTrustedOperator(),{userId:'fixture'});await assert.rejects(requireTrustedOperator('authority_review'),/OPERATOR_REQUIRED/);
member.scopes=['authority_review'];assert.deepEqual(await requireTrustedOperator('authority_review'),{userId:'fixture'});await assert.rejects(requireTrustedOperator(),/OPERATOR_REQUIRED/);
for(const change of [{scopes:[]},{revoked_at:new Date().toISOString()},{expires_at:new Date(Date.now()-1).toISOString()}]){member={expires_at:new Date(Date.now()+86400000).toISOString(),revoked_at:null,scopes:['support'],...change};await assert.rejects(requireTrustedOperator(),/OPERATOR_REQUIRED/);}
member=null;await assert.rejects(requireTrustedOperator(),/OPERATOR_REQUIRED/);user=null;calls=[];await assert.rejects(requireTrustedOperator(),/SIGN_IN_REQUIRED/);assert.equal(calls.length,0);
delete globalThis.__trustedOperator;console.log('Trusted operators: explicit least-privilege scopes, support cannot approve authority, no default grants, expiry/revocation and verified-session requirement passed.');
