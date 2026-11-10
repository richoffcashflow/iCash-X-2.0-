// Real PostgreSQL SQL engine (PGlite), synthetic rows only. Not multi-session concurrency.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const original=read('tests/fixtures/voice-contact-holds-before.sql');
const migration=read('config/voice-contact-holds-terminal-prefilter.sql');
const migrationFiles=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(p=>p.endsWith('_voice_contact_holds_terminal_prefilter.sql'));
assert.equal(migrationFiles.length,1);assert.equal(read('supabase/migrations/'+migrationFiles[0]),migration);
const downstream=JSON.parse(read('tests/fixtures/voice-contact-holds-downstream.json'));
const db=await PGlite.create(),q=(s,a=[])=>db.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),other=id(2);
const diff=`select count(*)::int from ((select * from fixture_original_holds() except all select * from icash_voice_contact_holds()) union all (select * from icash_voice_contact_holds() except all select * from fixture_original_holds())) d`;

const metadata=()=>val(`select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'volatility',provolatile,'security',prosecdef) from pg_proc where oid='icash_voice_contact_holds()'::regprocedure`);
try {
 await db.exec(read('tests/fixtures/stalled-voice-capacity-schema.sql'));
 await db.exec(`alter table icash_voice_capacity_policy add credit_state text;
 create table icash_recording_private.capacity_quarantines(operation_key text,account_id uuid,voice_job_id uuid,contact_key text);
 create index fixture_recording_operation on icash_call_recordings(operation_key);
 create index fixture_gate_recording on icash_recorded_gate_terminal_receipts(recording_id);
 create index fixture_cost_recording on icash_recording_private.terminal_cost_receipts(recording_id);
 insert into icash_voice_configs(account_id,agent_id) values('${account}','agent'),('${other}','agent');
 insert into icash_voice_capacity_policy values(1,32,now(),'available');
 insert into icash_voice_agent_capacity values('agent',32,now());
 insert into icash_wallets values('${account}',30000,0),('${other}',30000,0);`);
 await db.exec(original);
 assert.equal(await val("select md5(pg_get_functiondef('icash_voice_contact_holds()'::regprocedure))"),'c02f30febf4d8615de5280a3256dc6fc');
 await db.exec(original.replace('public.icash_voice_contact_holds()','public.fixture_original_holds()'));
 for(const f of downstream)await db.exec(f.definition);
 await db.exec('revoke all on function icash_voice_contact_holds() from public,anon,authenticated;grant execute on function icash_voice_contact_holds() to service_role;');
 // Cartesian variation: terminal/nonterminal/missing status, each receipt type,
 // wrong/null recording/account/call identity and null candidate identity.
 let n=10;
 for(const kind of ['gate','cost'])for(const status of ['completed','failed','busy','no-answer','canceled','in-progress',null])for(const mismatch of ['none','recording','account','sid','null-sid','null-operation','null-account']){
  n++;const op=mismatch==='null-operation'?null:'voice:'+id(n),a=mismatch==='null-account'?null:account,sid=mismatch==='null-sid'?null:'CA'+n;
  await q(`insert into icash_call_recordings(id,account_id,operation_key,voice_job_id,agent_id,contact_key,state,call_sid) values($1,$2,$3,$1,'agent',$4,'active',$5)`,[id(n),a,op,'contact-'+n,sid]);
  const receipt={status,...(kind==='cost'?{callSid:mismatch==='sid'?'wrong':sid}:{})};
  if(kind==='gate')await q('insert into icash_recorded_gate_terminal_receipts values($1,$2,$3,$4)',[id(mismatch==='recording'?9999:n),mismatch==='account'?other:a,mismatch==='sid'?'wrong':sid,receipt]);
  else await q('insert into icash_recording_private.terminal_cost_receipts values($1,$2)',[id(mismatch==='recording'?9999:n),receipt]);
  // Duplicates across arms and within a UNION arm; NULLs must deduplicate too.
  await q("insert into icash_live_conversations values($1,$2,'agent',$3,'waiting'),($1,$2,'agent',$3,'review')",[op,a,'contact-'+n]);
  await q("insert into icash_recorded_reception_private.sessions values($1,$2,'agent',$3,null)",[op,a,'contact-'+n]);
 }
 // Every negative field in the original provider-rejection predicate.
 for(const field of [null,'recording_sid','conversation_id','start_claimed_at','consent_at','recording_authorized_at','provider_started_at','end_requested_at','call_sid','live','job','wrong-account','missing-rejection']){
  n++;await q(`insert into icash_call_recordings(id,account_id,operation_key,voice_job_id,agent_id,contact_key,state,last_error) values($1,$2,$3,$1,'agent',$3,'failed','provider_rejected_call_creation')`,[id(n),account,'reject:'+n]);
  if(field!=='missing-rejection')await q('insert into icash_recording_private.call_creation_rejections values($1,$2,$3)',[id(n),field==='wrong-account'?other:account,'reject:'+n]);
  if(field==='live')await q("insert into icash_live_conversations(operation_key,state) values($1,'complete')",['reject:'+n]);
  else if(field==='job')await q("insert into icash_voice_jobs(id,provider_call_sid) values($1,'late-call')",[id(n)]);
  else if(field && !['wrong-account','missing-rejection'].includes(field))await q(`update icash_call_recordings set ${field}=${field.endsWith('_at')?'now()':"'late-evidence'"} where id=$1`,[id(n)]);
 }
 // Same operation across accounts, and same recipient across different operations.
 await db.exec(`insert into icash_call_recordings(id,account_id,operation_key,agent_id,contact_key,call_ended_at) values('${id(300)}','${account}','shared','agent','same',now());
 insert into icash_live_conversations values('shared','${other}','agent','same','waiting'),('unknown','${other}','agent','same','review');`);
 await db.exec(original.replace(' with candidates as (',' -- incompatible predecessor\n with candidates as ('));
 await assert.rejects(()=>db.exec(migration),/prerequisite changed/);await db.exec('rollback');
 await db.exec(original);
 const beforeMeta=await metadata();
 // Table snapshots without relying on any private/customer data.
 const tables=(await q("select schemaname,tablename from pg_tables where schemaname in ('public','icash_recording_private','icash_recorded_reception_private') order by 1,2")).rows;
 const snapshots=async()=>Promise.all(tables.map(t=>val(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${t.schemaname}.${t.tablename} t`)));
 const beforeData=await snapshots();
 await db.exec(migration);
 console.log('Optimized function MD5: '+await val("select md5(pg_get_functiondef('icash_voice_contact_holds()'::regprocedure))"));
 assert.deepEqual(await metadata(),beforeMeta,'OID, owner, ACL, stable volatility, definer, search_path unchanged');
 assert.deepEqual(await snapshots(),beforeData,'migration does not change any evidence, job, policy or money row');
 assert.equal(await val(diff),0,'all terminal identity, NULL, status, duplicate and rejection cases equal');
 assert.equal(await val("select count(*)::int from icash_voice_contact_holds() where operation_key='shared'"),1,'ended evidence never leaks across accounts');
 for(const f of downstream)assert.equal(await val('select md5(pg_get_functiondef(oid)) from pg_proc where proname=$1',[f.name]),f.hash,'downstream final gates unchanged');
 // Freshness: a late incoming hold after selection must block final admission.
 for(const t of tables)await db.exec(`truncate ${t.schemaname}.${t.tablename}`);
 await db.exec(`insert into icash_voice_configs(account_id,agent_id) values('${account}','agent'),('${other}','agent');insert into icash_voice_capacity_policy values(1,32,now(),'available');insert into icash_voice_agent_capacity values('agent',32,now());insert into icash_wallets values('${account}',30000,0);`);
 const snapshot=await val('select icash_recording_private.voice_capacity_snapshot()');
 await db.exec(`insert into icash_recorded_reception_private.sessions values('incoming:new','${other}','agent','same',null);`);
 assert.equal(await val("select icash_recording_private.voice_capacity_from_snapshot($1,'agent','new','same',false,$2)",[account,snapshot]),true);
 assert.equal(await val("select icash_voice_capacity_available($1,'agent','new','same',false)",[account]),false,'final admission rereads fresh recipient hold');
 // Unknown operations and quarantines retain recipient holds; late provider IDs
 // restore capacity occupancy without restarting an operation.
 await db.exec(`insert into icash_voice_jobs(id,account_id,state,outcome,operational_contact_id) values('${id(400)}','${other}','held','provider_outcome_unknown_no_retry','${id(400)}');insert into icash_voice_contact_targets(id,account_id,contact_key) values('${id(400)}','${other}','unknown-contact');insert into icash_recording_private.capacity_quarantines values('voice:${id(400)}','${other}','${id(400)}','unknown-contact');`);
 assert.equal(await val(diff),0);
 assert.equal(await val("select count(*)::int from icash_active_voice_slots() where contact_key='unknown-contact'"),0);
 assert.equal(await val("select icash_voice_capacity_available($1,'agent','new','unknown-contact',false)",[account]),false);
 await db.exec(`update icash_voice_jobs set provider_call_sid='late-provider' where id='${id(400)}'`);
 assert.equal(await val("select count(*)::int from icash_active_voice_slots() where contact_key='unknown-contact'"),1);
 // Even without production uniqueness constraints, a terminal sibling must
 // exclude every matching nonterminal row; other accounts remain independent.
 await db.exec(`insert into icash_call_recordings(id,account_id,operation_key,agent_id,contact_key,state,call_sid) values('${id(501)}','${other}','sibling','agent','one','active','CA501'),('${id(502)}','${other}','sibling','agent','two','active','CA502');insert into icash_recorded_gate_terminal_receipts values('${id(501)}','${other}','CA501','{"status":"completed"}');`);
 assert.equal(await val(diff),0);
 assert.equal(await val("select count(*)::int from icash_voice_contact_holds() where operation_key='sibling'"),0);
 await db.exec(read('tests/fixtures/voice-contact-holds-volume.sql'));
 assert.equal(await val(diff),0,'10,000 terminal history rows preserve exact holds');
 const body=s=>s.split('AS $function$')[1].split('$function$')[0];
 const oldPlan=(await q('explain(analyze,buffers,format json) '+body(original))).rows[0]['QUERY PLAN'][0];
 const newDefinition=await val("select pg_get_functiondef('icash_voice_contact_holds()'::regprocedure)");
 const newPlan=(await q('explain(analyze,buffers,format json) '+body(newDefinition))).rows[0]['QUERY PLAN'][0];
 const walk=n=>[n,...(n.Plans??[]).flatMap(walk)];
 const candidateRows=p=>{
  const nodes=walk(p.Plan).filter(n=>['Append','Merge Append'].includes(n['Node Type']));
  assert(nodes.length>0,'Plan contains the candidate UNION append');
  return Math.max(...nodes.map(n=>n['Actual Rows']));
 };
 assert(candidateRows(oldPlan)>=10000,'Original plan materializes historical candidates');
 assert(candidateRows(newPlan)<100,'Exact terminal prefilter removes historical candidates before UNION/dedup');
 console.log(`History candidates ${candidateRows(oldPlan)}->${candidateRows(newPlan)}; timings ${oldPlan['Execution Time']}->${newPlan['Execution Time']} ms (not a native throughput claim).`);
 // Exact predecessor guards fail closed, atomically, including repeat apply.
 await assert.rejects(()=>db.exec(migration),/prerequisite changed/);await db.exec('rollback');
 console.log('PASS voice holds: 98 receipt-binding combinations, 13 rejection variants, NULL/duplicate/account isolation, metadata/evidence preservation, fresh final capacity, unknown recipient quarantine and late provider occupancy.');
}finally{await db.close();}
