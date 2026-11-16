// Disposable native PostgreSQL only. CI mapping is the repository's localhost
// PostgreSQL service; local opt-in uses a different fixed port. No URLs/secrets.
import assert from 'node:assert/strict';
import {Client,connection} from '../tests/helpers/discovery-opener-refresh-native-db.mjs';
import {createDiscoveryOpenerRefreshFixture} from '../tests/helpers/discovery-opener-refresh-fixture.mjs';
import {verifyDiscoveryOpenerRefresh} from '../tests/helpers/discovery-opener-refresh-assertions.mjs';
const admin=new Client({...connection,database:'postgres'});let created=false,f,a,b;
try{
 await admin.connect();
 assert.equal((await admin.query('select current_database() db')).rows[0].db,'postgres');
 assert.equal((await admin.query('select 1 from pg_database where datname=$1',[connection.database])).rowCount,0,'Dedicated fixture database must not preexist');
 await admin.query('create database icash_discovery_refresh_test');created=true;
 f=await createDiscoveryOpenerRefreshFixture(new URL('../tests/helpers/discovery-opener-refresh-native-db.mjs',import.meta.url).pathname);
 console.log('PASS native common assertions',await verifyDiscoveryOpenerRefresh(f,{issuer:false}));
 a=new Client({...connection,application_name:'discovery-refresh-holder'});b=new Client({...connection,application_name:'discovery-refresh-contender'});
 await a.connect();await b.connect();
 await a.query("set timezone='UTC';set statement_timeout='10s';set lock_timeout='8s'");await b.query("set timezone='UTC';set statement_timeout='10s';set lock_timeout='8s';set role service_role");
 const aid=(await a.query('select pg_backend_pid() pid')).rows[0].pid,bid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 const original=await f.one('select to_jsonb(t) value from icash_text_threads t where id=$1',[f.thread]);
 const sourceHash=(await f.one("select encode(sha256(convert_to(icash_discovery_refresh_private.snapshot($1)::text,'UTF8')),'hex') h",[f.message])).h;
 const prepare='select icash_prepare_discovery_opener_refresh($1,$2,$3) id',args=[f.message,sourceHash,'SIMULATION concurrent exact original review'];
 await a.query('begin');const id=(await a.query(prepare,args)).rows[0].id;assert(id);
 const competing=b.query(prepare,args);competing.catch(()=>{});
 let observed=false;for(let n=0;n<200;n++){const state=await f.one('select $2::int=any(pg_blocking_pids($1)) blocked',[bid,aid]);if(state.blocked){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
 assert(observed,'second actual backend waits on original scheduler admission lock');
 await a.query('commit');assert.equal((await competing).rows[0].id,null,'only one renewal');
 const r=await f.ready(id);
 const apply='select icash_apply_discovery_opener_refresh($1) applied';
 // An uncommitted Pause holds the account row, so NOWAIT must yield; the
 // committed Pause must also refuse, rather than using a stale snapshot.
 await a.query('begin');await a.query('update icash_accounts set bot_paused=true where id=$1',[f.account]);
 assert.equal((await b.query(apply,[r.review])).rows[0].applied,false,'late locked Pause yields');
 await a.query('commit');assert.equal((await b.query(apply,[r.review])).rows[0].applied,false,'committed Pause wins');
 await a.query('update icash_accounts set bot_paused=false where id=$1',[f.account]);
 // Same recipient lock as STOP/dispatch: an admitted STOP blocks apply, and
 // the subsequent committed suppression remains authoritative.
 await a.query('begin');await a.query('select pg_advisory_xact_lock(hashtextextended($1,74))',[f.phone]);
 await a.query("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION concurrent STOP')",[f.phone]);
 assert.equal((await b.query(apply,[r.review])).rows[0].applied,false,'recipient lock yields');
 await a.query('rollback'); // Never erase a committed STOP or its revocations to make apply pass.
 assert.deepEqual(await f.one('select to_jsonb(t) value from icash_text_threads t where id=$1',[f.thread]),original,'failed concurrent applies leave original thread exact');
 // Competing actual apply transactions cannot both consume the review.
 await a.query('begin');assert.equal((await a.query(apply,[r.review])).rows[0].applied,true);
 assert.equal((await b.query(apply,[r.review])).rows[0].applied,false,'concurrent apply yields');
 await a.query('commit');assert.equal((await b.query(apply,[r.review])).rows[0].applied,false,'committed apply is one use');
 assert.equal((await f.one('select count(*)::int n from icash_discovery_refresh_private.applies')).n,1);
 assert.equal((await f.one('select count(*)::int n from icash_text_messages')).n,1);
 assert.equal((await f.one("select count(*)::int n from icash_operation_spend where operation_key like 'text:%'")).n,0);
 const issued=await f.rpc('icash_recover_unstarted_seller_opener',{});assert(issued?.token,'real ordinary issuer admits refreshed draft in following transaction');
 assert.equal((await f.one('select issue_attempts from icash_automation_tickets where token=$1',[issued.token])).issue_attempts,2);
 assert.equal((await f.one("select count(*)::int n from icash_operation_spend where operation_key like 'text:%'")).n,0);
 await a.query("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION final committed STOP')",[f.phone]);
 const successor=(await f.one('select successor_contact_id id from icash_discovery_refresh_private.renewals where id=$1',[r.id])).id;
 assert.equal((await a.query("select icash_operational_contact_current($1,$2,'sms',false) allowed",[f.account,successor])).rows[0].allowed,false,'committed STOP revokes new contact');
 console.log('PASS native PostgreSQL contention: observed competing-prepare lock, late Pause, late STOP, one-use competing apply, no send/operation.');
}catch(error){console.error(error.stack,error.cause?.where??error.where??'');process.exitCode=1;}
finally{await a?.query('rollback').catch(()=>{});await b?.query('rollback').catch(()=>{});await a?.end();await b?.end();await f?.pg.close();if(created)await admin.query('drop database icash_discovery_refresh_test');await admin.end();}
