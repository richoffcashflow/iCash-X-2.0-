// Isolated actual SQL, no providers, production writes or credentials.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
const path=process.argv[2];if(!path||!isAbsolute(path))throw Error('Provide the installed PGlite module absolute path');
const {PGlite}=await import(pathToFileURL(path).href),pg=await PGlite.create();
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table public.icash_accounts(id uuid primary key,owner_user_id uuid);create table public.icash_deal_files(id uuid primary key,account_id uuid,terms jsonb,stage text,seller_signed_at timestamptz);create table public.icash_operation_rates(id uuid primary key default gen_random_uuid(),operation text,enabled boolean,expires_at timestamptz);create table public.icash_market_shortlist(zip text,state text);`);
 const source=read('supabase/migrations/20260929001207_ordered_contract_signing.sql');
 await pg.exec(source.slice(0,source.indexOf('create function public.icash_lock_sent_terms()')));
 await pg.exec(`alter table public.icash_signing_templates alter column provider_template_id type text;alter table public.icash_signing_templates add column provider text default 'docuseal';`);
 // Preserve the currently deployed assignment stages in this production-function fixture.
 let def=(await pg.query("select pg_get_functiondef('public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure) as d")).rows[0].d;
 await pg.exec(def.replace("d.stage not in ('under_contract','buyer_selected')","d.stage not in ('under_contract','buyer_selected','title_open','closing')"));
 await pg.exec('revoke all on function public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;grant execute on function public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb) to service_role');
 const beforeRoutingDef=(await pg.query("select pg_get_functiondef('public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure) as d")).rows[0].d;
 const security=async()=>(await pg.query("select proacl,prosecdef,proconfig from pg_proc where oid='public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure")).rows;const securityBefore=await security();
 await pg.exec(read('config/standard-contract-routing.sql'));await pg.exec(read('config/standard-contract-routing.sql'));
 await pg.exec(`insert into public.icash_accounts values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');insert into public.icash_operation_rates values('00000000-0000-4000-8000-000000000003','contract_signing',true,now()+interval '1 day');insert into public.icash_market_shortlist values('38118','TN'),('75217','TX'),('35206','AL');insert into public.icash_signing_templates(state_code,kind,signer_count,provider_template_id,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled,rate_id) values('TX','purchase',1,'6101264','["Seller","Customer"]','{}',now()+interval '1 day','Fixture owner wording approval; no counsel claim',false,true,'00000000-0000-4000-8000-000000000003'),('TX','assignment',1,'6101265','["Assignee","Customer"]','{}',now()+interval '1 day','Fixture owner wording approval; no counsel claim',false,true,'00000000-0000-4000-8000-000000000003');`);
 const ready=async(zip,count=1)=>(await pg.query('select public.icash_market_contract_ready($1,$2) as r',[zip,count])).rows[0].r;
 assert(await ready('75217'));assert(!await ready('38118'));
 const before=(await pg.query('select to_jsonb(t)-\'template_scope\' as row from icash_signing_templates t order by kind')).rows;
 await pg.exec(read('config/standard-contract-template-selection.sql'));
 assert.deepEqual((await pg.query('select to_jsonb(t)-\'template_scope\' as row from icash_signing_templates t order by kind')).rows,before);
 for(const zip of ['38118','75217','35206'])assert(await ready(zip));for(const [zip,count] of [['38118',2],['38118',0],['99999',1]])assert(!await ready(zip,count));
 const call=async({state='TN',count=2,user='00000000-0000-4000-8000-000000000002',kind='purchase',stage='draft',scope='standard'}={})=>{
  const id=(await pg.query("insert into icash_deal_files values(gen_random_uuid(),'00000000-0000-4000-8000-000000000001',jsonb_build_object('state',$1::text),$2,case when $2='draft' then null else now() end) returning id",[state,stage])).rows[0].id;
  return pg.query("select public.icash_begin_signing($1,'00000000-0000-4000-8000-000000000001',$2,$3,(select id from icash_signing_templates where kind=$3 and template_scope=$5),repeat('a',64),$4)",[user,id,kind,JSON.stringify(Array.from({length:count},(_,i)=>({id:String(i+1)}))),scope]);
 };
 await call();await call({state:'AL'});await call({kind:'assignment',stage:'title_open'});await assert.rejects(()=>call({count:3}),/All signers/);await assert.rejects(()=>call({user:'00000000-0000-4000-8000-000000000009'}),/Account ownership/);await assert.rejects(()=>call({kind:'assignment'}),/Executed purchase/);
 for(const patch of ["enabled=false","test_mode=true","provider='signwell'","reviewed_until=now()-interval '1 day'"]){await pg.exec('begin');await pg.exec("update icash_signing_templates set "+patch+" where kind='assignment'");assert(!await ready('38118'));await pg.exec('rollback');}
 for(const patch of ["enabled=false","operation='seller_call'","expires_at=now()-interval '1 day'"]){await pg.exec('begin');await pg.exec('update icash_operation_rates set '+patch);assert(!await ready('38118'));await pg.exec('rollback');}
 await pg.exec('begin');await pg.exec("update icash_signing_templates set reviewed_until=now()-interval '1 day' where kind='purchase'");await assert.rejects(()=>call(),/no rows/);await pg.exec('rollback');
 for(const role of ['anon','authenticated'])assert.equal((await pg.query("select has_function_privilege($1,'public.icash_market_contract_ready(text,integer)','EXECUTE') as r",[role])).rows[0].r,false);
 await pg.exec(`insert into icash_signing_templates(state_code,kind,signer_count,provider_template_id,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled,rate_id,template_scope) select state_code,kind,signer_count,case when kind='purchase' then '6101299' else '6101300' end,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled,rate_id,'state' from icash_signing_templates where template_scope='standard'`);
 assert.equal((await pg.query("select count(*)::int n from icash_signing_templates where state_code='TX'")).rows[0].n,4);
 await pg.exec(`insert into icash_signing_templates(state_code,kind,signer_count,provider_template_id,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled,rate_id,template_scope) select state_code,kind,signer_count,provider_template_id,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled,rate_id,'state' from icash_signing_templates where template_scope='state' on conflict(state_code,kind,signer_count,test_mode) where template_scope='state' do update set enabled=excluded.enabled`);
 await call({state:'TX',scope:'state'});await call({state:'TX',scope:'state',kind:'assignment',stage:'title_open'});await assert.rejects(()=>call({state:'TN',scope:'state'}),/no rows/);
 for(const scope of ['state','standard'])await assert.rejects(()=>pg.exec(`insert into icash_signing_templates select gen_random_uuid(),state_code,kind,signer_count,provider_template_id,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled,rate_id,provider,template_scope from icash_signing_templates where template_scope='${scope}' limit 1`),/duplicate key/);
 assert.deepEqual(await security(),securityBefore);
 def=(await pg.query("select pg_get_functiondef('public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure) as d")).rows[0].d;
 assert.equal(def,beforeRoutingDef.replace("and state_code=d.terms->>'state'","and (template_scope='standard' or state_code=d.terms->>'state')"));
 console.log('PASS actual SQL: standard pair supports TN/AL/TX, exact count/expiry/rates/provider/account/stage guards persist, metadata unchanged, idempotent patch and service-only access.');
}finally{await pg.close();}
