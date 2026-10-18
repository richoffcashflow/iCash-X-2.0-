import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {PGlite} from '@electric-sql/pglite';
import {listMetaCostAccounts,listMetaCostCampaigns,sellerMetaCostEnvironment,MetaCostError,syncSellerMetaCosts} from '../lib/seller-meta-costs.ts';
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',token='synthetic-meta-read-token-123456',old='synthetic-old-read-token-654321';
let user={id:owner},origin=true,saved=null,readFailure=false,saveFailure=false,providerFailure=false,rows=[{id:'act_123456789',name:'Fixture account',currency:'USD'}],sources=[],calls=[],requests=[];
const db=async(path,method,body)=>{
 calls.push({path,method,body});
 if(path==='rpc/icash_seller_meta_access'){if(readFailure)throw Error('private database error');return saved;}
 if(path.startsWith('icash_seller_meta_sources?'))return sources;
 if(path==='rpc/icash_save_seller_meta_access'){if(saveFailure)throw Error('private database error');saved=body.p_token;return true;}
 throw Error('Unexpected database operation');
};
const fetchBefore=globalThis.fetch,versionBefore=process.env.META_GRAPH_VERSION,tokenBefore=process.env.META_ADS_READ_ACCESS_TOKEN;
process.env.META_GRAPH_VERSION='v26.0';process.env.META_ADS_READ_ACCESS_TOKEN=old;
globalThis.fetch=async(url,options)=>{
 const u=new URL(url);requests.push({url:u,options});assert.equal(u.origin,'https://graph.facebook.com');assert.equal(options.method,'GET');assert(!u.searchParams.has('access_token'));
 if(providerFailure)return Response.json({error:{code:190,message:'Private provider error '+token}},{status:400});
 return Response.json({data:u.pathname.endsWith('/campaigns')?[{id:'987654321',name:'Fixture campaign'}]:rows});
};
const mocks={z,db,MetaCostError,listMetaCostAccounts,listMetaCostCampaigns,sellerMetaCostEnvironment,dashboardCurrentUser:async()=>user,ownerInboundTarget:{ownerUserId:owner},allowedOrigin:()=>origin};
globalThis.__metaAccessRoute=mocks;
const source=ts.transpileModule(readFileSync(new URL('../app/api/seller/costs/meta/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const route=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(mocks).join(',')+'}=globalThis.__metaAccessRoute;\n'+source).toString('base64'));
const req=(input={token})=>new Request('https://www.geticashx.com/api/seller/costs/meta',{method:'POST',headers:{origin:'https://www.geticashx.com','content-type':'application/json'},body:JSON.stringify(input)});
const get=()=>new Request('https://www.geticashx.com/api/seller/costs/meta');
try{
 user=null;assert.equal((await route.POST(req())).status,403);assert.equal((await route.GET(get())).status,403);
 user={id:'00000000-0000-4000-8000-000000000001'};assert.equal((await route.POST(req())).status,403);
 user={id:owner};origin=false;assert.equal((await route.POST(req())).status,403);origin=true;
 assert.equal(calls.length,0);assert.equal(requests.length,0,'Authorization precedes token validation or provider work');
 for(const input of [{token:'123'}, {token:'x'.repeat(4097)}, {token:token+'\ninside'}, {token,actor:'another-owner'}, {}])assert.equal((await route.POST(req(input))).status,400);
 assert.equal((await route.POST(new Request(get(),{method:'POST',body:'invalid-json'}))).status,400);
 assert.equal((await route.POST(req({token:'x'.repeat(6001)}))).status,413);assert.equal(requests.length,0);
 providerFailure=true;let response=await route.POST(req());assert.equal(response.status,503);assert(!(await response.text()).includes(token));providerFailure=false;assert.equal(saved,null);
 rows=[];assert.equal((await route.POST(req())).status,400);assert.equal(saved,null);
 rows=[{id:'act_123456789',name:'Fixture account',currency:'USD'}];sources=[{ad_account:'act_999999999'}];assert.equal((await route.POST(req())).status,400);assert.equal(saved,null);sources=[];
 saveFailure=true;response=await route.POST(req());assert.equal(response.status,503);assert(!(await response.text()).includes(token));assert.equal(saved,null);saveFailure=false;
 response=await route.POST(req({token:' '+token+' '}));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(saved,token);
 const body=await response.json();assert.equal(body.saved,true);assert.equal(body.accounts[0].id,'act_123456789');assert(!JSON.stringify(body).includes(token));assert.deepEqual(calls.at(-1).body,{p_actor:owner,p_token:token});
 assert.equal((await route.GET(get())).status,200);assert.equal(requests.at(-1).options.headers.Authorization,'Bearer '+token,'Saved access is used immediately, without a deploy');
 assert.equal((await route.GET(new Request(get().url+'?account=act_123456789'))).status,200);
 readFailure=true;const n=requests.length;assert.equal((await route.GET(get())).status,503);assert.equal(requests.length,n,'Read failure cannot silently use an old credential');readFailure=false;
 saved=null;await route.GET(get());assert.equal(requests.at(-1).options.headers.Authorization,'Bearer '+old,'Existing environment setup still works when no owner token exists');
 const workerCalls=[],workerToken=token;const workerDb=async(path,_method,body)=>{
  workerCalls.push({path,body});if(path.includes('claim_'))return {id:'fixture',token:'lease',accountId:'act_123456789',metaCampaignId:'987654321'};
  if(path==='rpc/icash_seller_meta_access')return workerToken;return true;
 };
 const workerFetch=async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer '+workerToken);const u=new URL(url);return Response.json(u.pathname.endsWith('/insights')?{data:[]}:u.pathname.endsWith('/987654321')?{id:'987654321',account_id:'123456789'}:{id:'act_123456789',currency:'USD',timezone_name:'America/Chicago'});};
 assert.equal((await syncSellerMetaCosts(workerDb,{VERCEL_ENV:'production',META_GRAPH_VERSION:'v26.0'},workerFetch)).status,'synced');assert(!JSON.stringify(workerCalls).includes(workerToken));
}finally{globalThis.fetch=fetchBefore;if(versionBefore===undefined)delete process.env.META_GRAPH_VERSION;else process.env.META_GRAPH_VERSION=versionBefore;if(tokenBefore===undefined)delete process.env.META_ADS_READ_ACCESS_TOKEN;else process.env.META_ADS_READ_ACCESS_TOKEN=tokenBefore;delete globalThis.__metaAccessRoute;}

// Local Vault adapter contains fictional values only. Actual Vault encryption is
// checked separately against the installed extension inside a rolled-back transaction.
const pg=new PGlite();
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;create schema vault;
 create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,secret text,description text);
 create view vault.decrypted_secrets as select id,name,secret as decrypted_secret from vault.secrets;
 create function vault.create_secret(new_secret text,new_name text default null,new_description text default '',new_key_id uuid default null) returns uuid language sql as $$insert into vault.secrets(name,secret,description) values(new_name,new_secret,new_description) returning id$$;
 create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null,new_key_id uuid default null) returns void language sql as $$update vault.secrets set secret=coalesce(new_secret,secret) where id=secret_id$$;
 grant usage on schema vault to service_role;grant select,insert,update on vault.secrets to service_role;grant select on vault.decrypted_secrets to service_role;
 insert into vault.secrets(name,secret) values('unrelated-fixture-secret','preserve-this-fixture');`);
 const sql=readFileSync(new URL('../config/seller-meta-access.sql',import.meta.url),'utf8');assert.equal(sql,readFileSync(new URL('../supabase/migrations/20261018032640_seller_meta_access.sql',import.meta.url),'utf8'));await pg.exec(sql);
 const query=(s,v=[])=>pg.query(s,v);const value=async(s,v=[])=>(await query('select '+s+' as value',v)).rows[0].value;
 for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(value('public.icash_seller_meta_access()'),/permission denied/);await assert.rejects(value('public.icash_save_seller_meta_access($1,$2)',[owner,token]),/permission denied/);await pg.exec('reset role');}
 await pg.exec('set role service_role');assert.equal(await value('public.icash_seller_meta_access()'),null);
 await assert.rejects(value('public.icash_save_seller_meta_access($1,$2)',[null,token]),/Owner required/);
 await assert.rejects(value('public.icash_save_seller_meta_access($1,$2)',['00000000-0000-4000-8000-000000000001',token]),/Owner required/);
 await assert.rejects(value('public.icash_save_seller_meta_access($1,$2)',[owner,'bad']),/Valid Meta token/);
 assert.equal(await value('public.icash_save_seller_meta_access($1,$2)',[owner,token]),true);assert.equal(await value('public.icash_seller_meta_access()'),token);
 await value('public.icash_save_seller_meta_access($1,$2)',[owner,old]);assert.equal(await value('public.icash_seller_meta_access()'),old);
 assert.equal(Number(await value("(select count(*) from vault.secrets where name='icash_seller_meta_ads_read_v1')")),1);assert.equal(await value("(select secret from vault.secrets where name='unrelated-fixture-secret')"),'preserve-this-fixture');
 assert.equal(Number(await value("(select count(*) from pg_proc where proname in ('icash_seller_meta_access','icash_save_seller_meta_access') and prosecdef)")),0,'Helpers never elevate the caller');
}finally{await pg.close();}
console.log('PASS Meta access: owner/origin gates, bounded inputs, token validation before save, preserved connections on failure, private encrypted-storage RPC scope, immediate saved-token use, worker integration and no secret in browser responses.');
