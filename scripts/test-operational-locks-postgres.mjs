// Real two-session PostgreSQL locks, synthetic data only; no calls/provider traffic.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createOperationalContactFixture} from '../tests/helpers/operational-contact-fixture.mjs';
import {Client,connection} from '../tests/helpers/operational-native-db.mjs';
const f=await createOperationalContactFixture(fileURLToPath(new URL('../tests/helpers/operational-native-db.mjs',import.meta.url)));
const {q,rpc,one,account,phone,sender,project,pg}=f;
const a=new Client({...connection,application_name:'operational-dispatch-lock'}),b=new Client({...connection,application_name:'operational-incoming-lock'});
try{
 await q('grant usage on schema extensions to service_role'); // Match hosted extension-schema baseline, fixture only.
 await Promise.all([a.connect(),b.connect()]);await a.query("set statement_timeout='5s'");await b.query("set statement_timeout='5s'");
 await q('set role service_role');assert.equal(await project(),1);await q('reset role');
 const thread=(await one('select id from icash_text_threads where account_id=$1',[account])).id;
 await a.query('begin');await a.query('set local role service_role');await a.query('select 1 from icash_operating_budget where id=1 for update');
 const event={id:'native-incoming-race',type:'text.incoming.sms',data:{from:phone,to:sender,body:'Hello'}};
 await b.query('set role service_role');
 const pending=b.query('select icash_ingest_text_event($1,false)',[event]);
 // Establish that the real incoming backend is blocked on a lock, not merely scheduled late.
 let blocked=false;for(let i=0;i<100;i++){const row=await one("select wait_event_type from pg_stat_activity where application_name='operational-incoming-lock'");if(row.wait_event_type==='Lock'){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}
 assert(blocked,'Incoming transaction reaches shared lock boundary');
 // Without the entry-point fix incoming locks thread first, so this NOWAIT fails.
 await a.query('select 1 from icash_text_threads where id=$1 for update nowait',[thread]);
 await a.query('commit');await pending;
 assert.equal((await one("select count(*)::int n from icash_text_messages where event_id='native-incoming-race'")).n,1);
 // Existing event idempotency survives wrapper and no new outbound communication is dispatched.
 await b.query('select icash_ingest_text_event($1,false)',[event]);
 assert.equal((await one("select count(*)::int n from icash_text_messages where event_id='native-incoming-race'")).n,1);
 // Direct queue calls must also block on budget BEFORE touching existing jobs.
 const permission=(await one("insert into icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,permission_evidence,permission_until,dnc_checked_at,dnc_clear) values($1,$2,'seller',$3,encode(sha256(convert_to($3,'UTF8')),'hex'),$4,'SIMULATION independent legacy evidence',now()+interval '1 day',now(),true) returning id",[account,f.screening,phone,f.timezone])).id;
 const job=(await one("insert into icash_voice_jobs(account_id,permission_id,state,updated_at) values($1,$2,'issued',now()-interval '10 minutes') returning id",[account,permission])).id;
 await a.query('begin');await a.query('set local role service_role');await a.query('select 1 from icash_operating_budget where id=1 for update');
 const queuePending=b.query('select icash_queue_voice_jobs()');
 let queueBlocked=false;for(let i=0;i<100;i++){const row=await one("select wait_event_type from pg_stat_activity where application_name='operational-incoming-lock'");if(row.wait_event_type==='Lock'){queueBlocked=true;break;}await new Promise(r=>setTimeout(r,10));}
 assert(queueBlocked,'Direct queue reaches budget lock before job mutation');
 assert.equal((await a.query('select state from icash_voice_jobs where id=$1 for update nowait',[job])).rows[0].state,'issued');
 await a.query('commit');await queuePending;
 assert.equal((await one('select state from icash_voice_jobs where id=$1',[job])).state,'ready');
 for(const role of ['anon','authenticated']){await q('set role '+role);await assert.rejects(rpc('icash_lock_operational_dnc',{p_account:account,p_contact:f.dnc}),/permission denied/);await q('reset role');}
 console.log('PASS native PostgreSQL: incoming/dispatch and direct-queue/dispatch lock-order races, service-role entrypoints, event idempotency and unauthorized helper denial. No sends.');
}catch(error){console.error(error.message);process.exitCode=1;}finally{await a.query('rollback').catch(()=>{});await Promise.all([a.end(),b.end(),pg.close()]);}
