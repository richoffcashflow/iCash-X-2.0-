import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

export async function verifyOutreachProjection(db,owner){
 await db.exec('create schema icash_reliability_private; grant usage on schema icash_reliability_private to service_role;');
 const originals=JSON.parse(read('tests/fixtures/owner-outreach-projection-before.json'));
 for(const f of originals){
  await db.exec(f.definition);
  await db.exec(f.definition.replace('public.'+f.proname+'(', 'public.'+f.proname+'_projection_baseline('));
 }
 const metadata=async()=> (await db.query(`select proname,provolatile,prosecdef,proconfig,proacl::text,prolang from pg_proc where oid in
 ('public.icash_seller_interest_quote(jsonb)'::regprocedure,'public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text)'::regprocedure) order by proname`)).rows;
 const before=await metadata();
 const patch=read('config/owner-outreach-decoded-projection.sql');
 const migrations=readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('_owner_outreach_decoded_projection.sql'));
 assert.equal(migrations.length,1);assert.equal(patch,read('supabase/migrations/'+migrations[0]));
 // Exact predecessor drift must abort before creating the shared parser.
 const reportDefinition=originals.find(f=>f.proname==='icash_owner_outreach_report').definition;
 await db.exec(reportDefinition.replace('Owner required','Changed owner guard'));
 await assert.rejects(()=>db.exec(patch),/prerequisite changed/);
 await db.exec('rollback');
 assert.equal((await db.query("select to_regprocedure('icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb)') found")).rows[0].found,null);
 await db.exec(reportDefinition);
 await db.exec(patch);
 assert.deepEqual(await metadata(),before,'Read-only metadata, owner and service permissions stay unchanged');
 const acl=(await db.query(`select has_function_privilege('anon','icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb)','execute') anon,
 has_function_privilege('authenticated','icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb)','execute') authenticated,
 has_function_privilege('service_role','icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb)','execute') service,
 provolatile,prosecdef from pg_proc where oid='icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb)'::regprocedure`)).rows[0];
 assert.deepEqual(acl,{anon:false,authenticated:false,service:true,provolatile:'i',prosecdef:false});
 let comparisons=0;
 async function compareReport(days=1,include=false,query='',page=1,status='all'){
  const row=(await db.query('select public.icash_owner_outreach_report($1,$2,$3,$4,$5,$6) current,public.icash_owner_outreach_report_projection_baseline($1,$2,$3,$4,$5,$6) previous',[owner,days,include,query,page,status])).rows[0];
  assert.deepEqual(row.current,row.previous,'Every original total, row, date, filter and ordering remains identical');comparisons++;
 }
 const questions=['Would you be interested in selling?','Would you be open to a cash offer if the price and timing worked for you?','Are you the owner?','Are you interested in hearing more?','Are you interested in selling? Are you the owner?',null,42];
 const answers=['Yes.','No thanks.','I want to sell my house.','Stop calling me.','I am not the owner.','Please leave a short message after the tone.','at the beach thank you','[silence]','',null,42];
 const values=[null,{},[],42,'text',{transcript:null},{transcript:{}},{transcript:[]},{transcript:[null,{}, {role:'user'}]}];
 for(const question of questions)for(const answer of answers)values.push({transcript:[{role:'agent',message:question},{role:'user',message:answer}]});
 values.push({transcript:[{role:'agent',message:questions[0]},{role:'user',message:'Yes.'},{role:'user',message:'Stop calling me.'}]});
 for(const value of values)for(const evidence of [undefined,'automated_answer','no_response','seller']){
  const input=value&&typeof value==='object'&&!Array.isArray(value)?{...value,...(evidence===undefined?{}:{contactEvidence:evidence})}:value;
  const r=(await db.query('select public.icash_seller_interest_quote($1) current,public.icash_seller_interest_quote_projection_baseline($1) previous',[typeof input==='string'?JSON.stringify(input):input])).rows[0];
  assert.deepEqual(r.current,r.previous,'Canonical interest cannot bypass refusals, malformed turns or automated-answer evidence');comparisons++;
 }
 for(const status of ['all','responded','interested','queued','held'])for(const days of [1,7,30])for(const include of [false,true])await compareReport(days,include);
 for(const page of [1,2,3,100])for(const query of ['', 'test', '%_', 'no match'])await compareReport(7,false,query,page);
 const snapshots=[null,{},[],42,'scalar',{propertyId:'p1',propertyType:'house',sellerRequest:null},{propertyId:'p1',propertyType:'house',sellerRequest:{}},{propertyId:'p1',propertyType:'house',practice:true},{propertyId:'p1',propertyType:'house',practice:false},{propertyId:['p1'],propertyType:{value:'house'},address:42}];
 const results=[null,{},[],42,'scalar',{property:null,financialCheck:null},{property:{propertyId:'p1',address:42},financialCheck:{status:'eligible'}},{property:[],financialCheck:[]},{property:{propertyId:'p1',address:''},financialCheck:{status:'eligible'}}];
 for(const snapshot of snapshots){
  await db.query("update icash_screening_jobs set snapshot=$1 where id=md5('s1')::uuid",[typeof snapshot==='string'?JSON.stringify(snapshot):snapshot]);await compareReport();
 }
 await db.exec(`update icash_screening_jobs set snapshot='{"propertyId":"p1","propertyType":"house"}' where id=md5('s1')::uuid`);
 for(const result of results){await db.query("update icash_screening_jobs set result=$1 where id=md5('s1')::uuid",[typeof result==='string'?JSON.stringify(result):result]);await compareReport();}
 for(const state of ['complete','ready',null])for(const result of values.slice(0,12).concat([
  {optedOut:true,transcript:[{role:'user',message:'I want to sell my house.'}]},
  {transcript:[{role:'agent',message:questions[0]},{role:'user',message:'Yes.'}]},
  {transcript:[{role:'agent',message:questions[0]},{role:'user',message:'Yes.'},{role:'user',message:'Stop calling me.'}]},
 ])){
  await db.query("update icash_live_conversations set state=$1,result=$2 where id=md5('c1')::uuid",[state,typeof result==='string'?JSON.stringify(result):result]);await compareReport();
 }
 // Count real call-level classification with the unchanged original underneath.
 const disposition=originals.find(f=>f.proname==='icash_seller_call_disposition').definition;
 await db.exec(disposition.replace('public.icash_seller_call_disposition(', 'public.icash_seller_call_disposition_counted_original('));
 await db.exec(`create sequence projection_disposition_calls;
 create or replace function public.icash_seller_call_disposition(p_result jsonb) returns text language plpgsql volatile set search_path='' as $$
 begin perform nextval('public.projection_disposition_calls');return public.icash_seller_call_disposition_counted_original(p_result);end $$;
 update icash_live_conversations set result='{"transcript":[]}',state='complete';
 update icash_live_conversations set result='{"transcript":[{"role":"agent","message":"Would you be interested in selling?"},{"role":"user","message":"Yes."}]}' where id=md5('c1')::uuid;`);
 const calls=async name=>{
  await db.exec('alter sequence projection_disposition_calls restart with 1');
  await db.query('select public.'+name+'($1,1,false,\'\',1,\'all\')',[owner]);
  return (await db.query('select case when is_called then last_value else 0 end count from projection_disposition_calls')).rows[0].count;
 };
 // Restore the included source row after malformed-projection cases.
 await db.exec(`update icash_screening_jobs set snapshot='{"propertyId":"p1","propertyType":"house"}',result='{"property":{"propertyId":"p1","address":"1 Test Street"},"financialCheck":{"status":"eligible"}}' where id=md5('s1')::uuid`);
 const oldCalls=await calls('icash_owner_outreach_report_projection_baseline'),newCalls=await calls('icash_owner_outreach_report');
 assert.equal(Number(oldCalls)-Number(newCalls),1,'Report eliminates the repeated disposition scan for the same interested call');
 await db.exec(disposition);
 await db.exec('grant select on all tables in schema public to service_role; begin read only; set local role service_role');
 await compareReport();await db.exec('commit');
 await assert.rejects(()=>db.exec(patch),/prerequisite changed/);await db.exec('rollback');
 console.log('PASS decoded outreach projection: '+comparisons+' canonical/report equivalence checks, source-null distinctions, source/tenant/date/pagination fixtures, shared parser, immutable reads, private ACL, drift rollback and one fewer real disposition scan.');
}
