// Actual deployed admission functions in local PostgreSQL, no provider work.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const baseline=JSON.parse(read('tests/fixtures/eighty-percent-voice-capacity-before.json'));
const migration=read('config/full-business-voice-capacity.sql');
const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(p=>p.endsWith('_full_business_voice_capacity.sql'));
assert.equal(files.length,1);assert.equal(read('supabase/migrations/'+files[0]),migration);
const native=!!process.env.ICASH_PG_MODULE;
let pg,Client;
const fixtureDatabase=process.env.ICASH_FULL_VOICE_NATIVE==='1'?'icash_full_voice_capacity':'icash_reliability';
const connection={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:fixtureDatabase,application_name:'full-business-capacity-fixture',connectionTimeoutMillis:5000};
if(native){
 ({Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE));const client=new Client(connection);await client.connect();
 assert.equal(client.connection.stream.remoteAddress,'127.0.0.1');assert.equal(client.connection.stream.remotePort,55443);
 assert.equal((await client.query('select current_database() db')).rows[0].db,fixtureDatabase);
 assert.equal((await client.query("select count(*)::int n from pg_tables where schemaname='public' or schemaname like 'icash_%'")).rows[0].n,0,'Only an empty disposable fixture database');
 await client.query("set statement_timeout='10s';set lock_timeout='5s'");
 pg={query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql),close:()=>client.end()};
}else {const {PGlite}=await import('@electric-sql/pglite');pg=await PGlite.create();}
const q=(s,a=[])=>pg.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const install=()=>pg.exec('begin;\n'+migration+'\ncommit;');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await pg.exec(read('tests/fixtures/eighty-percent-voice-capacity-foundation.sql'));
 for(const f of baseline.functions)await pg.exec(f.definition);
 for(const f of baseline.functions)assert.equal(await val('select md5(pg_get_functiondef(oid)) from pg_proc where proname=$1',[f.name]),f.hash);
 const save=(total=40,outgoing=38,creditState='available')=>val('select icash_save_voice_capacity($1,$2::jsonb,$3)',[total,JSON.stringify([{agentId:'agent_outgoing',limit:outgoing,creditState},{agentId:'agent_incoming',limit:2,creditState}]),'Offline provider observation']);
 await pg.exec(read('config/eighty-percent-voice-capacity.sql'));
 await pg.exec("revoke all on all functions in schema public from public,anon,authenticated;grant execute on all functions in schema public to service_role;revoke all on all functions in schema icash_recording_private from public,anon,authenticated;grant execute on all functions in schema icash_recording_private to service_role;");
 await save(32,30);
 await pg.exec("update icash_voice_capacity_policy set pro_change_claimed_at=now()-interval '2 days',pro_change_applied_at=now()-interval '47 hours',eighty_change_enabled=true,eighty_change_claimed_at=now()-interval '1 day',eighty_change_applied_at=now()-interval '23 hours';");
 await assert.rejects(()=>save(),/Verified capacity required/);
 const beforeFunctions=await q("select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.proowner,p.prosecdef,p.provolatile,p.proconfig from pg_proc p where p.proname in ('icash_save_voice_capacity','icash_outgoing_voice_capacity_open','icash_voice_capacity_available','voice_capacity_from_snapshot','voice_capacity_snapshot') order by signature");
 const beforePolicy=await val('select to_jsonb(p) from icash_voice_capacity_policy p');
 await pg.exec('grant execute on function icash_outgoing_voice_capacity_open() to authenticated;');
 await assert.rejects(()=>install(),/prerequisite changed/);await pg.exec('rollback;');
 await pg.exec('revoke execute on function icash_outgoing_voice_capacity_open() from authenticated;');
 const originalOpen=beforeFunctions.rows.find(f=>f.signature==='icash_outgoing_voice_capacity_open()').definition;
 await pg.exec(originalOpen.replace('begin','begin\n -- Fixture source drift'));
 await assert.rejects(()=>install(),/prerequisite changed/);await pg.exec('rollback;');await pg.exec(originalOpen);
 await install();
 const afterPolicy=await val('select to_jsonb(p) from icash_voice_capacity_policy p');
 assert.deepEqual(afterPolicy,{...beforePolicy,full_change_enabled:false,full_change_release_sha:null,full_change_claimed_at:null,full_change_applied_at:null,full_change_before_hash:null,full_change_after_hash:null},'migration changes no observed capacity or credit evidence');
 for(const f of beforeFunctions.rows){
  const after=(await q("select pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.proowner,p.prosecdef,p.provolatile,p.proconfig from pg_proc p where p.oid=$1::regprocedure",[f.signature])).rows[0];
  const expected=f.definition.replace('p_limit not between 1 and 32','p_limit not between 1 and 40').replace('least(32,workspace_limit)','least(40,workspace_limit)');
  assert.deepEqual(after,Object.fromEntries(Object.entries({...f,definition:expected}).filter(([k])=>k!=='signature')),'source/ACL/owner/volatility/definer metadata remains identical beyond exact ceiling');
 }
 await save();await assert.rejects(()=>save(41,39),/Verified capacity required/);
 for(let n=1;n<=16;n++){await q('insert into icash_wallets values($1,3000)',[id(n)]);await q("insert into icash_voice_configs values($1,'agent_outgoing',true)",[id(n)]);}
 const allowed=(incoming=false,account=id(16),contact='new-contact',operation='new-operation',agent=incoming?'agent_incoming':'agent_outgoing')=>val('select icash_voice_capacity_available($1,$2,$3,$4,$5)',[account,agent,operation,contact,incoming]);
 const open=()=>val('select icash_outgoing_voice_capacity_open()');
 const outgoing=n=>q("insert into fixture_slots values($1,$2,'agent_outgoing',$3)",[id(Math.floor((n-1)/3)+1),'outgoing-'+n,'contact-'+n]);
 const incoming=n=>q("insert into fixture_slots values($1,$2,'agent_incoming',$3)",[id(15),'recorded-reception:'+n,'incoming-'+n]);
 for(const incomingFirst of [true,false]){
  await pg.exec('truncate fixture_slots');
  if(incomingFirst){await incoming(1);await incoming(2);}
  for(let n=1;n<=38;n++){assert.equal(await allowed(),true,`slot ${n} available with incomingFirst=${incomingFirst}`);assert.equal(await open(),true);await outgoing(n);}
  assert.equal(await allowed(),false,'thirty-ninth outgoing cannot consume the incoming reserve');assert.equal(await open(),false);
  if(!incomingFirst){assert.equal(await allowed(true),true);await incoming(1);assert.equal(await allowed(true),true);await incoming(2);}
  assert.equal(await allowed(true),false,'total and incoming agent limits stop the forty-first call');
 }
 await pg.exec('truncate fixture_slots');await outgoing(1);await outgoing(2);await outgoing(3);
 assert.equal(await allowed(false,id(1)),false,'original per-account fairness is preserved');assert.equal(await allowed(),true);
 assert.equal(await allowed(false,id(16),'contact-1'),false,'same recipient never overlaps');
 await q("insert into fixture_holds values($1,$2,'agent_outgoing',$3)",[id(4),'uncertain','held-contact']);
 assert.equal(await allowed(false,id(16),'held-contact'),false,'uncertain recipient hold is unchanged');
 await q('update icash_wallets set balance_cents=0 where account_id=$1',[id(16)]);assert.equal(await allowed(),false);
 await q('update icash_wallets set balance_cents=3000 where account_id=$1',[id(16)]);
 await save(40,38,'exhausted');assert.equal(await allowed(),false);assert.equal(await open(),false);assert.equal(await allowed(true),true,'exhaustion preserves incoming reception');
 await save(40,38,'unknown');assert.equal(await allowed(),false,'unknown evidence cannot clear exhaustion');
 await save();assert.equal(await allowed(),true);
 // A quarantined operation frees capacity only while its original unknown
 // identity has no later provider evidence; its recipient always stays held.
 await pg.exec('truncate fixture_slots,fixture_holds');
 await q("insert into fixture_holds values($1,'uncertain','agent_outgoing','held-contact')",[id(4)]);
 await q("insert into icash_recording_private.capacity_quarantines values($1,'uncertain','held-contact',$2)",[id(4),id(100)]);
 assert.equal(await val("select jsonb_array_length(icash_recording_private.voice_capacity_snapshot()->'slots')"),0);
 assert.equal(await allowed(false,id(16),'held-contact'),false);
 await q("insert into icash_voice_jobs values($1,'held','observed-provider-id',null)",[id(100)]);
 assert.equal(await val("select jsonb_array_length(icash_recording_private.voice_capacity_snapshot()->'slots')"),1,'late identity restores occupied capacity');
 await pg.exec('truncate fixture_slots,fixture_holds,icash_voice_jobs,icash_recording_private.capacity_quarantines');
 await pg.exec("update icash_voice_capacity_policy set verified_at=now()-interval '25 hours'");
 assert.equal(await allowed(),true);await outgoing(1);assert.equal(await allowed(),false,'stale workspace evidence has only one fallback slot');
 await pg.exec('truncate fixture_slots');await save();
 const release='a'.repeat(40),beforeHash='b'.repeat(64),afterHash='c'.repeat(64);
 const change=(action,sha=release,before=beforeHash,after=afterHash)=>val('select icash_full_business_voice_capacity_change($1,$2,$3,$4)',[action,sha,before,after]);
 const state=(status,claimed=false,evidence=false)=>({claimed,status,releaseSha:status==='disabled'?null:release,beforeHash:evidence?beforeHash:null,afterHash:evidence?afterHash:null});
 assert.deepEqual(await change('status'),state('disabled'));
 assert.deepEqual(await change('claim'),state('disabled'));
 assert.deepEqual(await change('complete'),state('disabled'));
 await assert.rejects(()=>change('enable','bad'),/Exact release required/);
 assert.deepEqual(await change('enable'),state('ready'));
 await assert.rejects(()=>change('enable','d'.repeat(40)),/already bound/);
 await assert.rejects(()=>change('claim','d'.repeat(40)),/release mismatch/);
 await assert.rejects(()=>change('claim',release,null,afterHash),/original evidence required/);
 assert.deepEqual(await change('complete'),state('ready'),'no completion without a durable claim');
 let claims;
 if(native){
  const clients=await Promise.all(Array.from({length:24},async()=>{const client=new Client(connection);await client.connect();return client;}));
  try{claims=await Promise.all(clients.map(async c=>(await c.query('select icash_full_business_voice_capacity_change($1,$2,$3,$4) state',['claim',release,beforeHash,afterHash])).rows[0].state));}
  finally{await Promise.all(clients.map(c=>c.end()));}
 }else claims=await Promise.all([change('claim'),change('claim')]);
 assert.equal(claims.filter(x=>x.claimed).length,1,'exactly one competing transaction may send PATCH');
 await save();assert.deepEqual(await change('status'),state('claimed',false,true),'ordinary observations cannot reset the claim');
 await assert.rejects(()=>change('claim',release,'d'.repeat(64),afterHash),/original evidence changed/);
 await assert.rejects(()=>change('complete',release,beforeHash,'d'.repeat(64)),/original evidence changed/);
 assert.deepEqual(await change('complete'),state('applied',false,true));
 const receipt=await val('select full_change_applied_at from icash_voice_capacity_policy');
 await save(10,8);assert.deepEqual(await change('claim'),state('applied',false,true),'later manual reductions do not replay configuration');
 await change('complete');assert.deepEqual(await val('select full_change_applied_at from icash_voice_capacity_policy'),receipt);
 const finalPolicy=await val('select to_jsonb(p) from icash_voice_capacity_policy p');
 for(const key of ['pro_change_claimed_at','pro_change_applied_at','eighty_change_enabled','eighty_change_claimed_at','eighty_change_applied_at'])assert.deepEqual(finalPolicy[key],beforePolicy[key],'prior approval receipt remains unchanged');
 await assert.rejects(()=>change('reset'),/Invalid full capacity action/);
 for(const role of ['anon','authenticated'])assert.equal(await val("select has_function_privilege($1,'icash_full_business_voice_capacity_change(text,text,text,text)','execute')",[role]),false);
 assert.equal(await val("select has_function_privilege('service_role','icash_full_business_voice_capacity_change(text,text,text,text)','execute')"),true);
 console.log('PASS full Business capacity: 38 outgoing plus2 incoming in either arrival order, exact existing source/ACL/admission/hold preservation, unchanged observations and historical receipts, exact release/original evidence binding and one durable provider-write winner. Native:',native);
}finally{await pg.close();}
