import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import * as policy from '../lib/custom-voice-preview-policy.ts';
import * as voices from '../lib/custom-voice-policy.ts';

const root=new URL('../',import.meta.url),read=path=>readFileSync(new URL(path,root),'utf8');
const pg=await PGlite.create();
const a='00000000-0000-4000-8000-000000000001',u='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',v='00000000-0000-4000-8000-000000000004';
const bytes=new Uint8Array(2000);bytes.set([73,68,51]);
let calls=[],mode='success',failCache=false,voiceName=voices.providerVoiceName(v),verification={requires_verification:false};
async function reset(){
 calls=[];mode='success';failCache=false;voiceName=voices.providerVoiceName(v);verification={requires_verification:false};
 await pg.exec('delete from icash_custom_voice_previews;update icash_accounts set vip=true;');
 await pg.query("update icash_custom_voices set state='ready',enabled=false where account_id=$1",[a]);
}
const query=async(text,params=[])=>(await pg.query(text,params)).rows;
async function db(path,method='GET',body){
 if(path==='rpc/icash_vip_features_active')return (await query('select icash_vip_features_active($1) v',[body.p_account]))[0].v;
 if(path==='rpc/icash_begin_custom_voice_preview')return (await query('select icash_begin_custom_voice_preview($1,$2,$3,$4,$5) v',[body.p_user,body.p_account,body.p_voice,body.p_provider_voice,body.p_request]))[0].v;
 const [table,search]=path.split('?'),params=new URLSearchParams(search);
 assert(['icash_custom_voices','icash_custom_voice_previews'].includes(table),'Preview must never access the wallet, usage or calls');
 const values=[],where=[];
 for(const [key,value] of params){
  if(['select','order','limit'].includes(key))continue;
  assert(['id','account_id','custom_voice_id','voice_id','state'].includes(key));
  if(value.startsWith('eq.')){values.push(value.slice(3));where.push(`${key}=$${values.length}`);}
  else {assert.equal(value,'in.(generating,unknown)');where.push("state in ('generating','unknown')");}
 }
 if(method==='PATCH'){
  if(failCache&&body.state==='ready'){failCache=false;throw Error('fixture database disconnect');}
  const sets=Object.entries(body).map(([k,val])=>{assert(/^[a-z0-9_]+$/.test(k));values.push(val);return `${k}=$${values.length}`;});
  return query(`update ${table} set ${sets.join(',')} where ${where.join(' and ')} returning *`,values);
 }
 assert.equal(method,'GET');return query(`select * from ${table} where ${where.join(' and ')}${params.has('order')?' order by attempt desc limit 1':''}`,values);
}
const fetcher=async(url,init={})=>{
 calls.push({url,method:init.method??'GET'});assert.equal(init.redirect,'error');
 if(url.includes('/v1/voices/'))return Response.json({voice_id:'fixture_voice',name:voiceName,category:'cloned',is_owner:true,voice_verification:verification});
 if(url.includes('/v1/text-to-speech/')){
  assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),policy.customVoicePreviewRequest);
  if(mode==='timeout')throw Error('fixture unknown provider result');
  if(mode==='rejected')return new Response('private provider message',{status:429});
  if(mode==='rejected-history')return new Response('private provider message',{status:429,headers:{'history-item-id':'exact_history'}});
  if(mode==='bad-audio')return new Response('private provider message',{headers:{'Content-Type':'text/plain'}});
  if(mode==='oversize')return new Response(new Uint8Array(500001),{headers:{'Content-Type':'audio/mpeg'}});
  return new Response(bytes,{headers:{'Content-Type':'audio/mpeg','history-item-id':'exact_history','request-id':'exact_request','character-cost':'94'}});
 }
 assert.equal(url,'https://api.elevenlabs.io/v1/history/exact_history/audio');assert(!init.method||init.method==='GET');
 return new Response(bytes,{headers:{'Content-Type':'audio/mpeg'}});
};
const elevenRequest=async(path,_body,f)=>{const r=await f('https://api.elevenlabs.io'+path,{redirect:'error'});return r.json();};
const deps={...policy,...voices,db,elevenRequest};
globalThis.__voicePreviewDeps=deps;
const code=ts.transpileModule(read('lib/custom-voice-preview.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const api=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__voicePreviewDeps;\n'+code).toString('base64'));
process.env.ELEVENLABS_API_KEY='offline-fixture-only';
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,vip boolean,balance_cents integer,bot_paused boolean);
 create function icash_vip_active(p_account uuid) returns boolean language sql as $$select vip from public.icash_accounts where id=p_account$$;
 create function icash_vip_features_active(p_account uuid) returns boolean language sql as $$select vip from public.icash_accounts where id=p_account$$;`);
 await pg.exec(read('config/vip-custom-voice.sql'));await pg.exec(read('config/custom-voice-preview.sql'));
 await pg.query('insert into icash_accounts values($1,$2,true,0,true)',[a,u]);
 await pg.query("insert into icash_custom_voices(account_id,id,state,voice_id,enabled,consent_version,consent_user,sample_sha256) values($1,$2,'ready','fixture_voice',false,$3,$4,$5)",[a,v,voices.ownVoiceConsentVersion,u,'a'.repeat(64)]);
 await reset();assert.equal((await api.readCustomVoicePreview(a)).state,'empty');assert.equal(calls.length,0);
 let got=await api.prepareCustomVoicePreview(a,u,fetcher);assert.equal(got.state,'ready');assert.deepEqual(got.audio,bytes);
 assert.equal(calls.filter(c=>c.method==='POST').length,1);
 const row=(await query('select * from icash_custom_voice_previews'))[0];assert.equal(row.character_cost,94);assert.equal(row.history_item_id,'exact_history');
 delete process.env.ELEVENLABS_API_KEY;
 assert.equal((await api.readCustomVoicePreview(a)).state,'ready');assert.equal((await api.prepareCustomVoicePreview(a,u,fetcher)).state,'ready');assert.equal(calls.length,2,'All replays use saved audio, without even a provider read');
 assert.deepEqual((await query('select balance_cents,bot_paused from icash_accounts'))[0],{balance_cents:0,bot_paused:true});
 assert.equal((await query('select enabled from icash_custom_voices'))[0].enabled,false,'Preview never enables live calling');
 process.env.ELEVENLABS_API_KEY='offline-fixture-only';
 await assert.rejects(api.readCustomVoicePreview(other));
 await assert.rejects(pg.query('select icash_begin_custom_voice_preview($1,$2,$3,$4,$5)',[other,a,v,'fixture_voice',policy.customVoicePreviewRequest]));
 await pg.exec('update icash_accounts set vip=false');await assert.rejects(api.readCustomVoicePreview(a));await assert.rejects(api.prepareCustomVoicePreview(a,u,fetcher));
 await reset();voiceName='another-account';await assert.rejects(api.prepareCustomVoicePreview(a,u,fetcher));assert.equal((await query('select count(*) n from icash_custom_voice_previews'))[0].n,0);
 await reset();verification={requires_verification:true,is_verified:false};await assert.rejects(api.prepareCustomVoicePreview(a,u,fetcher));
 await reset();verification=undefined;assert.equal((await api.prepareCustomVoicePreview(a,u,fetcher)).state,'ready','Confirmed ready clones can omit optional provider verification fields');
 await reset();mode='timeout';assert.equal((await api.prepareCustomVoicePreview(a,u,fetcher)).state,'unavailable');
 await pg.exec("update icash_custom_voice_previews set created_at=now()-interval '1 day'");
 await api.prepareCustomVoicePreview(a,u,fetcher);assert.equal(calls.filter(c=>c.method==='POST').length,1,'An unknown paid request never repeats, even after expiry');
 await reset();failCache=true;assert.equal((await api.prepareCustomVoicePreview(a,u,fetcher)).state,'unavailable');
 got=await api.prepareCustomVoicePreview(a,u,fetcher);assert.equal(got.state,'ready');assert.equal(calls.filter(c=>c.method==='POST').length,1,'Failed storage recovers the exact history item without regeneration');
 for(const failure of ['bad-audio','oversize']){await reset();mode=failure;assert.equal((await api.prepareCustomVoicePreview(a,u,fetcher)).state,'unavailable');assert.equal((await api.readCustomVoicePreview(a)).state,'unavailable');}
 await reset();mode='rejected-history';await api.prepareCustomVoicePreview(a,u,fetcher);await pg.exec("update icash_custom_voice_previews set updated_at=now()-interval '2 minutes'");
 assert.equal((await api.prepareCustomVoicePreview(a,u,fetcher)).state,'ready');assert.equal(calls.filter(c=>c.method==='POST').length,1,'A rejection with an artifact receipt recovers rather than generating again');
 await reset();mode='rejected';
 for(let attempt=1;attempt<=4;attempt++){
  await api.prepareCustomVoicePreview(a,u,fetcher);
  await api.prepareCustomVoicePreview(a,u,fetcher); // No immediate rejection retry.
  await pg.exec("update icash_custom_voice_previews set updated_at=now()-interval '2 minutes'");
 }
 assert.equal(calls.filter(c=>c.method==='POST').length,3,'Known rejections have bounded retries and retain all three receipts');
 assert.equal((await query('select count(*) n from icash_custom_voice_previews'))[0].n,3);
 await reset();
 const rpc=()=>db('rpc/icash_begin_custom_voice_preview','POST',{p_user:u,p_account:a,p_voice:v,p_provider_voice:'fixture_voice',p_request:policy.customVoicePreviewRequest});
 const claims=await Promise.all(Array.from({length:5},rpc));assert.equal(claims.filter(c=>c.started).length,1);assert.equal((await api.readCustomVoicePreview(a)).state,'pending');
 await pg.exec("update icash_custom_voice_previews set created_at=now()-interval '1 day'");assert.equal((await api.readCustomVoicePreview(a)).state,'unavailable');assert.equal((await rpc()).started,false);
 await assert.rejects(pg.query('select icash_begin_custom_voice_preview($1,$2,$3,$4,$5)',[u,a,v,'fixture_voice',{...policy.customVoicePreviewRequest,text:'unlimited user text'}]));
 const acl=(await query("select has_table_privilege('anon','icash_custom_voice_previews','SELECT') a,has_table_privilege('authenticated','icash_custom_voice_previews','SELECT') b,has_function_privilege('authenticated','icash_begin_custom_voice_preview(uuid,uuid,uuid,text,jsonb)','EXECUTE') c"))[0];assert.deepEqual(acl,{a:false,b:false,c:false});
 // Route checks execute the actual handler with a signed-in zero-balance fixture.
 let authenticated=true,posts=0,reads=0;
 const routeDeps={NextResponse:{json:(data,init)=>Response.json(data,init)},workAccount:async opts=>{assert.equal(opts.requireVip,true);if(!authenticated)throw Error('SIGN_IN_REQUIRED');return {accountId:a,userId:u};},allowedOrigin:req=>req.headers.get('origin')==='https://geticashx.com',limitRequest:async()=>{},readCustomVoicePreview:async id=>{assert.equal(id,a);reads++;return {state:'ready',audio:bytes};},prepareCustomVoicePreview:async(id,user)=>{assert.equal(id,a);assert.equal(user,u);posts++;return {state:'ready',audio:bytes};}};
 globalThis.__voicePreviewRoutes=routeDeps;
 const routeCode=ts.transpileModule(read('app/api/account/custom-voice/preview/route.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
 const route=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(routeDeps).join(',')+'}=globalThis.__voicePreviewRoutes;\n'+routeCode).toString('base64'));
 let response=await route.GET();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.equal(posts,0);
 const request=(origin='https://geticashx.com',body)=>new Request('https://geticashx.com/api/account/custom-voice/preview',{method:'POST',headers:{origin},...(body?{body}:{})});
 assert.equal((await route.POST(request())).status,200);assert.equal(posts,1);
 const emptyStream=new Request('https://geticashx.com/api/account/custom-voice/preview',{method:'POST',headers:{origin:'https://geticashx.com'},body:new ReadableStream({start(controller){controller.close();}}),duplex:'half'});
 assert(emptyStream.body);assert.equal((await route.POST(emptyStream)).status,200);assert.equal(posts,2,'Next empty HTTP body stream is accepted');
 assert.equal((await route.POST(request('https://evil.example'))).status,403);assert.equal((await route.POST(request(undefined,'{"accountId":"another"}'))).status,400);assert.equal(posts,2);
 authenticated=false;assert.equal((await route.GET()).status,409);assert.equal((await route.POST(request())).status,409);assert.equal(posts,2);assert.equal(reads,1);
 console.log('PASS custom voice preview: actual SQL/service/routes, zero balance and Pause, private cached audio, tenant/VIP checks, no call toggles, exact history recovery, no unknown retries, bounded rejected attempts, audio size/type, fixed text, ACL and request origin. Native races run separately.');
}finally{await pg.close();delete process.env.ELEVENLABS_API_KEY;}
