import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {processMessaging} from '../lib/messaging-worker.ts';
import {campaignSettingsSchema,readCampaignSettings} from '../lib/messaging-settings.ts';
const settings={enabled:true,smsEnabled:true,smartFollowups:true,fromEmail:'sessions@example.test',postalAddress:'',subjects:['a','b','c'],messages:['a','b','c']};
test('independent worker is production-only and isolates campaign failures from customers',async()=>{
 const calls=[];
 const deps={production:false,database:async(path)=>{calls.push(path);return path.includes('activate')?1:['customer'];},followups:async()=>{calls.push('campaign');throw Error('Webinar unavailable');},customerUpdate:async(id)=>{calls.push(id);return {status:'updates_accepted'};}};
 assert.deepEqual(await processMessaging(deps),{status:'disabled'});assert.equal(calls.length,0);
 const result=await processMessaging({...deps,production:true});assert.equal(result.customers.accepted,1);assert.equal(result.campaign.unavailable,true);assert(calls.includes('customer'));
});
test('activation and scan failures cannot stop existing campaigns or silently opt in customers',async()=>{
 let sent=0;
 const result=await processMessaging({production:true,database:async()=>{throw Error('DB unavailable');},followups:async()=>({sent:++sent}),customerUpdate:async()=>{throw Error('Must not dispatch');}});
 assert.equal(result.customers.unavailable,true);assert.equal(result.campaign.sent,1);
 const active=await processMessaging({production:true,database:async(path)=>{if(path.includes('activate'))throw Error('Webinar unavailable');return ['existing'];},followups:async()=>({sent:0}),customerUpdate:async()=>({status:'updates_accepted'})});
 assert.equal(active.customers.activationFailed,true);assert.equal(active.customers.accepted,1);
});
test('messaging owner API rejects unauthenticated, cross-origin and stale writes',async()=>{
 let owner=true,origin=true,revision=1;const calls=[];
 class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
 const deps={z,campaignSettingsSchema,readCampaignSettings,customerUpdateConfiguration:()=>({email:true,sms:true}),webinarFollowupReadiness:()=>({email:false,sms:true}),WebinarError,
  webinarOwner:async()=>{if(!owner)throw new WebinarError(403,'Owner only');},webinarOrigin:()=>{if(!origin)throw new WebinarError(403,'Wrong origin');},webinarBody:req=>req.json(),webinarHeaders:{'Cache-Control':'private, no-store'},webinarError:e=>Response.json({error:e.message},{status:e.status||503}),
  db:async(path,method,body)=>{calls.push({path,method,body});if(path.startsWith('icash_messaging_settings'))return [{config:settings,revision}];if(path.startsWith('icash_customer_update_settings'))return [{enabled:true}];if(path==='rpc/icash_messaging_save'){if(body.p_revision!==revision)return null;return ++revision;}return {};},
 };
 globalThis.__messagingTest=deps;
 const source=ts.transpileModule(readFileSync(new URL('../app/api/messaging/admin/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 const api=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__messagingTest;\n'+source).toString('base64'));
 const body={settings,revision:1,customerUpdatesEnabled:true};const post=value=>api.POST(new Request('https://example.test/api/messaging/admin',{method:'POST',body:JSON.stringify(value)}));
 owner=false;assert.equal((await api.GET()).status,403);assert.equal((await post(body)).status,403);assert.equal(calls.length,0);
 owner=true;origin=false;assert.equal((await post(body)).status,403);assert.equal(calls.length,0);origin=true;
 assert.equal((await post({...body,settings:{...settings,meta:{enabled:false}}})).status,400);assert.equal(calls.length,0);
 assert.equal((await post(body)).status,200);assert.equal(calls.at(-1).path,'rpc/icash_messaging_save');assert.equal((await post(body)).status,409);
 const response=await api.GET();assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal((await response.json()).settings.fromEmail,settings.fromEmail);
 assert(calls.every(c=>!c.path.startsWith('icash_webinars')&&!c.path.startsWith('icash_webinar_settings')),'Opening messaging never depends on webinar records');
});
