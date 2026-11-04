import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('config/seller-interest-reviewed-question.sql');
assert.equal(migration,read('supabase/migrations/20261104052316_seller_interest_reviewed_question.sql'));
const functions=['icash_seller_interest_quote','icash_call_selling_interest'];
const beforeHashes=['54b4d07db92082f856fe148a0a0890b6','d2cc7e5da9ca74ed46687e47ac4be794'];
const afterHashes=['100b79d54c2f094f32672cf5979bd689','36ae5b81b3282f5f98d931f0082a751b'];
const catalog=async db=>(await db.query(`select p.proname,pg_get_functiondef(p.oid) definition,
 md5(pg_get_functiondef(p.oid)) checksum,p.provolatile,p.prosecdef,p.proconfig,p.proacl::text acl
 from pg_proc p where p.oid=any(array['public.icash_seller_interest_quote(jsonb)'::regprocedure,
 'public.icash_call_selling_interest(jsonb)'::regprocedure]) order by p.proname desc`)).rows;
const pair=question=>({interested:true,interestQuote:'Yes',transcript:[{role:'agent',message:question},{role:'user',message:'Yes'}]});
const timing=pair('Would you be open to a cash offer if the price and timing worked for you?');
const ownership=pair('Are you the owner?');
const classify=async(db,result)=>(await db.query('select icash_seller_interest_quote($1) quote,icash_call_selling_interest($1) interested',[result])).rows[0];

const db=new PGlite();
try{
 await db.exec('create role anon;create role authenticated;create role service_role;create table icash_screening_jobs(id uuid);');
 await db.exec(read('config/seller-response-policy.sql'));
 await db.exec(read('config/seller-optout-base-verbs.sql'));
 await db.exec(read('supabase/migrations/20261023175907_seller_call_contact_evidence.sql').match(/create or replace function public\.icash_call_has_seller_response[\s\S]*?\$\$;/)[0]);
 // Install the historical function bodies independently of the current-reader
 // fixture so this suite exercises the real before-to-after migration guards.
 for(const name of functions){
  const definition=read('config/seller-interest-evidence.sql').match(new RegExp('create function public\\.'+name+'\\(p_result jsonb\\)[\\s\\S]*?\\$\\$;'))?.[0];
  assert.ok(definition,`Historical definition for ${name}`);
  await db.exec(definition);
  await db.exec(`revoke all on function public.${name}(jsonb) from public,anon,authenticated;grant execute on function public.${name}(jsonb) to service_role;`);
 }
 const original=await catalog(db);
 assert.deepEqual(original.map(r=>r.checksum),beforeHashes,'Fixture matches both live pre-release definitions');
 assert.deepEqual(await classify(db,{...timing,interested:false}),{quote:null,interested:false});
 assert.deepEqual(await classify(db,ownership),{quote:null,interested:true},'Reproduce the unverified provider-flag shortcut');

 // Drift in either function prevents all changes, including to the other one.
 for(const target of original){
  await db.exec(target.definition.replace('AS $function$\n','AS $function$\n-- unreviewed drift fixture\n'));
  const drifted=await catalog(db);
  await assert.rejects(db.exec(migration),/seller interest function drift/);
  await db.exec('rollback');
  assert.deepEqual(await catalog(db),drifted,'Rejected migration leaves both definitions and ACLs intact');
  await db.exec(target.definition);
 }

 await db.exec(migration);
 const installed=await catalog(db);
 assert.deepEqual(installed.map(r=>r.checksum),afterHashes);
 assert.deepEqual(installed.map(({definition,checksum,...attributes})=>attributes),original.map(({definition,checksum,...attributes})=>attributes),'Volatility, invoker mode, search path and execute grants are preserved');
 assert.deepEqual(await classify(db,timing),{quote:'Yes',interested:true});
 assert.deepEqual(await classify(db,ownership),{quote:null,interested:false});
 for(const answer of ['Yes, if you pay a million dollars.','I am interested in selling if you pay a million dollars.','I am interested in selling, hypothetically.']){
  const conditional={...timing,transcript:[timing.transcript[0],{role:'user',message:answer}]};
  assert.deepEqual(await classify(db,conditional),{quote:null,interested:false},'Dollar delimiters must not consume the answer end anchors');
 }
 for(const result of [null,{}, {interested:true}, {...timing,optedOut:true}, {...timing,contactEvidence:'automated_answer'}, {...timing,contactEvidence:'no_response'}]){
  assert.equal((await classify(db,result)).interested,false,'Missing, opted-out and automated evidence cannot establish interest');
 }
 await db.exec(migration);
 assert.deepEqual(await catalog(db),installed,'Exact installed definitions are safely replayable');
 console.log('Seller interest forward migration: exact live prerequisites, atomic drift rejection for either helper, unchanged permissions, transcript-only results and idempotent replay passed.');
}finally{await db.close();}
