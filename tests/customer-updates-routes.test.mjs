import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {readCampaignSettings} from '../lib/messaging-settings.ts';
import * as policy from '../lib/customer-updates.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const calls=[];let signedIn=true,sameOrigin=true;
const mocks={readCampaignSettings,...policy,z,NextResponse:{json:(body,o={})=>({body,status:o.status??200,headers:o.headers})},workAccount:async()=>{if(!signedIn)throw Error('Sign in');return {accountId:id(1),userId:id(2)};},allowedOrigin:()=>sameOrigin,db:async(path,method,body)=>{calls.push({path,method,body});if(body?.p_account)assert.equal(body.p_account,id(1));if(body?.p_user)assert.equal(body.p_user,id(2));if(path.endsWith('sources'))return [{source_key:'reply:saved',kind:'seller_reply',screening_id:id(3),event_at:new Date().toISOString()}];if(path.endsWith('preferences_get'))return {email:'owner@example.com',emailEnabled:false,smsEnabled:false};if(path.startsWith('icash_messaging_settings'))return [{revision:1,config:{enabled:false,smsEnabled:false,smartFollowups:true,fromEmail:'sessions@example.com',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c']}}];if(path.startsWith('icash_customer_update_settings'))return [{enabled:true}];if(path.startsWith('icash_screening_jobs')){assert.match(path,/account_id=eq.00000000-0000-4000-8000-000000000001/);return [{id:id(3),home:{address:'Synthetic address'}}];}return {};}};
globalThis.__customerRoutes=mocks;
const source=ts.transpileModule(readFileSync(new URL('../app/api/notifications/updates/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const route=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(mocks).join(',')+'}=globalThis.__customerRoutes;\n'+source).toString('base64'));
const env={RESEND_API_KEY:'fixture',RESEND_RECEIVING_WEBHOOK_SECRET:'fixture',ICASH_TITLE_FROM_EMAIL:'alerts@example.com',ICASH_APP_ORIGIN:'https://example.com',CONTIGUITY_API_KEY:'fixture',CONTIGUITY_FROM:'+12125550100',CONTIGUITY_WEBHOOK_SECRET:'fixture'};
const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
const post=body=>route.POST(new Request('https://example.com/api/notifications/updates',{method:'POST',body:JSON.stringify(body)}));
try{
 let result=await route.GET();assert.equal(result.status,200);assert.equal(result.body.items.length,1);assert.equal(result.body.preferences.emailAvailable,true);assert.equal(result.headers['Cache-Control'],'private, no-store');
 calls.length=0;signedIn=false;assert.equal((await route.GET()).status,503);assert.equal(calls.length,0);signedIn=true;
 const valid={action:'preferences',emailEnabled:true,smsEnabled:true,phone:'(212) 555-0123',timezone:'America/Chicago',consentVersion:policy.botUpdateConsentVersion};
 sameOrigin=false;assert.equal((await post(valid)).status,403);assert.equal(calls.length,0);sameOrigin=true;
 for(const invalid of [{...valid,accountId:id(4)},{...valid,consentVersion:undefined},{...valid,phone:'invalid'},{action:'seen',before:new Date().toISOString(),accountId:id(4)}])assert.equal((await post(invalid)).status,400);
 assert.equal(calls.length,0);assert.equal((await post(valid)).status,200);assert.equal(calls.at(-1).body.p_phone,'+12125550123');assert.equal(calls.at(-1).body.p_user,id(2));
 delete process.env.RESEND_API_KEY;delete process.env.CONTIGUITY_API_KEY;assert.equal((await post({...valid,emailEnabled:false,smsEnabled:false,consentVersion:undefined})).status,200,'Opt-out works when channels are down');
 assert.equal((await post({action:'seen',before:new Date().toISOString()})).status,200);assert.equal(calls.at(-1).path,'rpc/icash_customer_updates_seen');
 console.log('Customer update API: authenticated tenant scope, source links, CSRF, strict payloads, explicit opt-in, phone normalization, read status and opt-out during outages passed. No external calls.');
}finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
