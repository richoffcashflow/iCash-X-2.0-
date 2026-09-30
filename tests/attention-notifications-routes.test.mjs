import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import ts from 'typescript';
import {z} from 'zod';
import * as policy from '../lib/attention-notifications.ts';
import {verifyTitleWebhook} from '../lib/title-inbound-policy.ts';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account = uuid(1), user = uuid(2), records = [];
let authorized = true, origin = true, failDatabase = false;
const mocks = {
  ...policy, z, verifyTitleWebhook,
  NextResponse: {json: (body, options = {}) => ({body, status: options.status ?? 200, headers: options.headers})},
  workAccount: async () => {if (!authorized) throw Error('SIGN_IN_REQUIRED'); return {accountId: account, userId: user};},
  allowedOrigin: () => origin,
  db: async (path, method, body) => {
    records.push({path, method, body}); if (failDatabase) throw Error('Database failed');
    if (path.includes('preferences')) {assert.equal(body.p_account, account); assert.equal(body.p_user, user); return {enabled: false, available: true, categories: policy.attentionCategories};}
    return null;
  },
};
globalThis.__attentionRoutes = mocks;
async function route(path) {
  let source = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm, '');
  source = 'const {' + Object.keys(mocks).join(',') + '}=globalThis.__attentionRoutes;\n' + source;
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const preferences = await route('app/api/notifications/preferences/route.ts');
const post = body => preferences.POST(new Request('https://example.com/api/notifications/preferences', {method: 'POST', body: JSON.stringify(body)}));
const valid = {enabled: true, categories: ['needs_you'], consentVersion: policy.attentionConsentVersion};
process.env.ICASH_ATTENTION_EMAIL_ENABLED = 'true'; process.env.RESEND_API_KEY = 'fixture'; process.env.ICASH_ATTENTION_WEBHOOK_SECRET = 'whsec_fixture'; process.env.ICASH_ATTENTION_FROM_EMAIL = 'alerts@example.com'; process.env.ICASH_APP_ORIGIN = 'https://example.com';
let result = await preferences.GET(); assert.equal(result.status, 200); assert.equal(result.body.available, true); assert.equal(result.headers['Cache-Control'], 'private, no-store');
records.length=0; authorized=false; result=await preferences.GET(); assert.equal(result.status,503); assert.equal(records.length,0); result=await post(valid); assert.equal(result.status,503); assert.equal(records.length,0); authorized=true;
origin=false; result=await post(valid); assert.equal(result.status,403); assert.equal(records.length,0); origin=true;
for (const body of [{...valid,accountId:uuid(99)}, {...valid,email:'victim@example.com'}, {...valid,categories:[]}, {...valid,categories:['unknown']}, {...valid,consentVersion:undefined}]) {
  records.length=0; result=await post(body); assert.equal(result.status,400); assert.equal(records.length,0,'Rejected input cannot mutate preferences');
}
result=await post(valid); assert.equal(result.status,200); assert.equal(records.at(-1).body.p_user,user); assert.equal(records.at(-1).body.p_enabled,true);
process.env.ICASH_ATTENTION_EMAIL_ENABLED='false'; records.length=0; result=await post(valid); assert.equal(result.status,503); assert.equal(records.length,0);
result=await post({...valid,enabled:false}); assert.equal(result.status,200,'Opt-out survives disabled global dispatch');

const unsubscribe = await route('app/api/notifications/unsubscribe/route.ts');
const token=uuid(3)+uuid(4), link='https://example.com/api/notifications/unsubscribe?token='+token;
records.length=0; result=await unsubscribe.GET(new Request(link)); assert.equal(result.status,200); assert.equal(records.length,0,'Link scanning never unsubscribes'); assert((await result.text()).includes('method="post"'));
result=await unsubscribe.GET(new Request('https://example.com/api/notifications/unsubscribe?token=<script>')); assert.equal(result.status,400); assert.equal(records.length,0);
result=await unsubscribe.POST(new Request(link,{method:'POST'})); assert.equal(result.status,200); assert.deepEqual(records.at(-1).body,{p_token:token}); assert.equal(result.headers.get('referrer-policy'),'no-referrer');
failDatabase=true; result=await unsubscribe.POST(new Request(link,{method:'POST'})); assert.equal(result.status,503); failDatabase=false;

const webhook=await route('app/api/notifications/events/route.ts');
const secret='whsec_'+Buffer.from('fixture-signature-key-32-bytes-ok').toString('base64'); process.env.ICASH_ATTENTION_WEBHOOK_SECRET=secret;
const payload={type:'email.bounced',data:{email_id:uuid(7),to:['owner@example.com'],tags:{icash_attention_id:uuid(8)}}};
function signedRequest(data,tamper=false){
  const raw=JSON.stringify(data),stamp=String(Math.floor(Date.now()/1000)),id='evt_fixture';
  const signature=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${stamp}.${raw}`).digest('base64');
  return new Request('https://example.com/api/notifications/events',{method:'POST',body:raw+(tamper?' ':''),headers:{'svix-id':id,'svix-timestamp':stamp,'svix-signature':'v1,'+signature}});
}
records.length=0; result=await webhook.POST(signedRequest(payload,true)); assert.equal(result.status,400); assert.equal(records.length,0);
result=await webhook.POST(signedRequest({...payload,data:{...payload.data,tags:{}}})); assert.equal(result.status,200); assert.equal(records.length,0,'Unrelated app mail is ignored');
result=await webhook.POST(signedRequest(payload)); assert.equal(result.status,200); assert.deepEqual(records.at(-1).body,{p_id:uuid(8),p_provider:uuid(7),p_recipient:'owner@example.com',p_event:'email.bounced'});
records.length=0; result=await webhook.POST(signedRequest({...payload,data:{...payload.data,to:['owner@example.com','other@example.com']}})); assert.equal(result.status,400); assert.equal(records.length,0);
failDatabase=true; result=await webhook.POST(signedRequest(payload)); assert.equal(result.status,503,'Provider will retry failed delivery bookkeeping');
delete globalThis.__attentionRoutes;
console.log('Attention routes: verified account scope, origin/strict consent, opt-out during downtime, safe GET/one-click POST unsubscribe, signed tagged delivery events and failure responses passed. No external calls.');
