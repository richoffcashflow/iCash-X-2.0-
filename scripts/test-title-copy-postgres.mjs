import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {installTitleCopyFixture,titleCopyCase,sendTitleCopyReply} from '../tests/fixtures/title-copy-fixture.mjs';
import {installTitleCopyClosingFixture} from '../tests/fixtures/title-copy-closing-fixture.mjs';
import {recordConfirmation,confirmation} from '../tests/fixtures/closing-original-source-fixture.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const connection={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',connectionTimeoutMillis:5000};
const name='title_copy_'+randomBytes(8).toString('hex'),clients=[];
const connect=async database=>{const c=new Client({...connection,database});await c.connect();await c.query("set statement_timeout='12s';set lock_timeout='8s'");c.exec=s=>c.query(s);return c;};
const admin=await connect('postgres');let pending;
try{
 await admin.query('create database '+name);const db=await connect(name),a=await connect(name),b=await connect(name);clients.push(db,a,b);await installTitleCopyFixture(db);
 const migration=readFileSync('config/title-executed-copy-requests.sql','utf8');assert.equal(migration,readFileSync('supabase/migrations/20261116234038_title_executed_copy_requests.sql','utf8'));
 await db.query('create table fixture_ledger(version text primary key)');
 await a.query('begin');await a.query(migration);await a.query("insert into fixture_ledger values('copy')");await assert.rejects(a.query("insert into fixture_ledger values('copy')"),/duplicate key/);await a.query('rollback');
 assert.equal((await db.query("select to_regnamespace('icash_title_copy_private') value")).rows[0].value,null);
 const pid=(await b.query('select pg_backend_pid() id')).rows[0].id;
 const waitLock=async()=>{for(let n=0;n<300;n++){if((await db.query("select wait_event_type='Lock' value from pg_stat_activity where pid=$1",[pid])).rows[0]?.value)return;await new Promise(r=>setTimeout(r,10));}assert.fail('Expected real concurrent lock wait');};
 await a.query('begin');await a.query(migration);await b.query('begin');pending=b.query(migration);pending.catch(()=>{});await waitLock();await a.query('commit');await assert.rejects(pending,/predecessor changed/);pending=null;await b.query('rollback');
 await db.query("update icash_title_copy_private.policy set enabled=true,activated_at=now()-interval '1 minute',release_sha=repeat('a',40)");
 const taskFor=async r=>(await db.query("select * from public.icash_title_tasks where reply_id=$1 and kind='document_update'",[r.id])).rows[0];
 const seed=async(body='Please send the purchase agreement.')=>{const c=await titleCopyCase(db),r=await sendTitleCopyReply(db,c,body),t=await taskFor(r);await db.query("update public.icash_title_tasks set email_state='issued' where id=$1",[t.id]);return {c,r,t};};
 const claim=(client,{c,t})=>client.query('select public.icash_claim_title_update($1,$2,$3) value',[c.account,t.id,t.payload]);
 // Source arriving first owns the common budget/request order and blocks dispatch.
 let s;
 for(const legacy of [false,true]){
  s=await seed();await a.query('begin;set local role service_role');await sendTitleCopyReply(a,s.c,'Do not send the purchase agreement.',{legacy});await b.query('begin;set local role service_role');pending=claim(b,s);pending.catch(()=>{});await waitLock();await a.query('commit');assert.equal((await pending).rows[0].value,null);pending=null;await b.query('commit');
  assert.equal((await db.query('select count(*)::int n from public.icash_operation_spend where operation_key=$1',['title-followup:'+s.t.id])).rows[0].n,0);
 }
 // Admission arriving first has a single original operation. Later withdrawal
 // cannot erase its uncertain receipt or manufacture a replacement.
 s=await seed();await a.query('begin;set local role service_role');assert((await claim(a,s)).rows[0].value);await b.query('begin;set local role service_role');pending=sendTitleCopyReply(b,s.c,'Do not send further documents.');pending.catch(()=>{});await waitLock();await a.query('commit');await pending;pending=null;await b.query('commit');
 assert.equal((await claim(db,s)).rows[0].value,null);assert.equal((await db.query('select email_state from public.icash_title_tasks where id=$1',[s.t.id])).rows[0].email_state,'dispatching');
 await b.query('begin;set local role service_role');assert.equal((await b.query('select public.icash_finish_title_copy($1,$2,$3) value',[s.c.account,s.t.id,'native-original-receipt'])).rows[0].value,true);await b.query('commit');
 assert.deepEqual((await db.query('select state,email_state,email_provider_id from public.icash_title_tasks where id=$1',[s.t.id])).rows[0],{state:'done',email_state:'sent',email_provider_id:'native-original-receipt'});
 assert.equal((await db.query('select needs_review from public.icash_title_replies where id=$1',[s.r.id])).rows[0].needs_review,true,'newer withdrawal preserves review while recording original receipt');
 // A manual Pause committed during the existing account-row wait is authoritative.
 s=await seed();await a.query('begin');await a.query('update public.icash_accounts set bot_paused=true where id=$1',[s.c.account]);await b.query('begin;set local role service_role');pending=claim(b,s);pending.catch(()=>{});await waitLock();await a.query('commit');assert.equal((await pending).rows[0].value,null);pending=null;await b.query('commit');
 assert.equal((await db.query('select count(*)::int n from public.icash_operation_spend where operation_key=$1',['title-followup:'+s.t.id])).rows[0].n,0);
 // A later signature observation committed while final admission waits on the
 // deal cannot reuse the request captured against the earlier document clock.
 s=await seed('Please send the assignment agreement.');
 await a.query('begin');await a.query('update public.icash_deal_files set assignment_signed_at=clock_timestamp() where id=$1',[s.c.deal]);
 await b.query('begin;set local role service_role');pending=claim(b,s);pending.catch(()=>{});await waitLock();await a.query('commit');assert.equal((await pending).rows[0].value,null);pending=null;await b.query('commit');
 assert.equal((await db.query('select count(*)::int n from public.icash_operation_spend where operation_key=$1',['title-followup:'+s.t.id])).rows[0].n,0);
 // An edit committed while the original receipt waits on the task row must be
 // retained. Receipt persistence must not complete a freshly changed work item.
 s=await seed();assert((await claim(db,s)).rows[0].value);
 await a.query('begin');await a.query("update public.icash_title_tasks set label='Manual expanded evidence',payload=payload||'{\"manualReview\":true}'::jsonb where id=$1",[s.t.id]);
 await b.query('begin;set local role service_role');pending=b.query('select public.icash_finish_title_copy($1,$2,$3) value',[s.c.account,s.t.id,'native-edited-receipt']);pending.catch(()=>{});await waitLock();await a.query('commit');assert.equal((await pending).rows[0].value,true);pending=null;await b.query('commit');
 assert.deepEqual((await db.query('select state,email_state,label from public.icash_title_tasks where id=$1',[s.t.id])).rows[0],{state:'scheduled',email_state:'sent',label:'Manual expanded evidence'});
 assert.equal((await db.query('select needs_review from public.icash_title_replies where id=$1',[s.r.id])).rows[0].needs_review,true);
 assert.equal((await db.query('select provider_id from icash_title_copy_private.receipts where task_id=$1',[s.t.id])).rows[0].provider_id,'native-edited-receipt');
 const originalTask=(await db.query('select * from public.icash_title_tasks where id=$1',[s.t.id])).rows[0];
 assert.equal((await b.query('select public.icash_finish_title_copy($1,$2,$3) value',[s.c.account,s.t.id,'native-edited-receipt'])).rows[0].value,true);
 assert.deepEqual((await db.query('select * from public.icash_title_tasks where id=$1',[s.t.id])).rows[0],originalTask,'Duplicate receipt is an observation, not another cleanup');
 const metadata=(await db.query("select proname,md5(pg_get_functiondef(oid)) hash,pg_get_userbyid(proowner) owner,proacl::text from pg_proc where oid in ('public.icash_claim_title_update(uuid,uuid,jsonb)'::regprocedure,'public.icash_record_title_reply_source(uuid,text,uuid,text,text,text,boolean,jsonb)'::regprocedure)")).rows;
 assert(metadata.every(r=>r.owner==='postgres'&&r.proacl==='{postgres=X/postgres,service_role=X/postgres}'));
 const copySourceHashes=(await db.query("select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) hash from pg_proc where oid in ('icash_title_copy_private.current_request(uuid)'::regprocedure,'icash_title_copy_private.envelope_source(public.icash_signing_envelopes)'::regprocedure,'icash_title_copy_private.dispatch_source(uuid,uuid,jsonb)'::regprocedure,'public.icash_prepare_title_copy(uuid,uuid,jsonb)'::regprocedure,'public.icash_finish_title_copy(uuid,uuid,text)'::regprocedure)")).rows;
 // Compose the actual closing guard and copy adapter, including both BEFORE
 // insert locks and the real closing task-cancellation trigger.
 await admin.query('create database '+name+'_composed');
 const composed=await connect(name+'_composed'),closing=await connect(name+'_composed'),copy=await connect(name+'_composed');clients.push(composed,closing,copy);
 const {first}=await installTitleCopyClosingFixture(composed);
 const reply=await sendTitleCopyReply(composed,first,'Please send the purchase agreement.');
 const copyTask=(await composed.query("select * from public.icash_title_tasks where reply_id=$1 and kind='document_update'",[reply.id])).rows[0];
 await composed.query("update public.icash_title_tasks set email_state='issued' where id=$1",[copyTask.id]);
 await closing.query('begin;set local role service_role');await recordConfirmation(closing,first,confirmation({date:await first.date(),agreement:first.assignment}));
 await copy.query('begin;set local role service_role');const copyPid=(await copy.query('select pg_backend_pid() id')).rows[0].id;
 pending=copy.query('select public.icash_claim_title_update($1,$2,$3) value',[first.account,copyTask.id,copyTask.payload]);pending.catch(()=>{});
 let copyBlocked=false;for(let n=0;n<300;n++){if((await composed.query("select wait_event_type='Lock' value from pg_stat_activity where pid=$1",[copyPid])).rows[0]?.value){copyBlocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert(copyBlocked,'Current closing visibly serializes before copy admission');
 await closing.query('commit');assert.equal((await pending).rows[0].value,null);pending=null;await copy.query('commit');
 assert.equal((await first.state()).deal.stage,'closed');assert.equal((await composed.query('select state from public.icash_title_tasks where id=$1',[copyTask.id])).rows[0].state,'cancelled');
 assert.equal((await composed.query('select count(*)::int n from public.icash_operation_spend where operation_key=$1',['title-followup:'+copyTask.id])).rows[0].n,0);
 console.log('PASS native title copy: migration atomicity, service-role source/claim order, one original dispatch, Pause, signature-clock race, changed-task receipt race and composed closing/copy lock order; '+JSON.stringify({metadata,copySourceHashes}));
}finally{
 for(const c of clients)await c.query('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});await Promise.allSettled(clients.map(c=>c.end()));await admin.query('drop database if exists '+name+'_composed with (force)');await admin.query('drop database if exists '+name+' with (force)');await admin.end();
}
