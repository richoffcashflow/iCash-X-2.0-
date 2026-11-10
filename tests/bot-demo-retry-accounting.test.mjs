import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {account,owner,botDemoRetryFixture} from './helpers/bot-demo-retry-fixture.mjs';
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
const hash=s=>createHash('sha256').update(s).digest('hex');
const ip='d'.repeat(64),ipKey='bot-demo:ip:'+ip,userKey='bot-demo:id:'+hash(owner);
const args=(request=randomUUID())=>[owner,account,request,'a'.repeat(64),'Demo Seller','45 Fixture Lane, Dallas, TX 75201','+12145550123',true,'b'.repeat(64),'America/Chicago','c'.repeat(64),ip];
const submit=async a=>(await one('select icash_submit_limited_bot_demo_intake('+a.map((_,i)=>'$'+(i+1)).join(',')+') id',a)).id;
const snapshot=async()=>({limits:(await q('select * from icash_request_limits order by bucket')).rows,leads:(await q('select * from icash_seller_intakes order by id')).rows});
const reset=()=>pg.exec('truncate icash_seller_intakes,icash_request_limits');
async function rejectsUnchanged(a,expected=/mismatch|required/){const before=await snapshot();await assert.rejects(submit(a),expected);assert.deepEqual(await snapshot(),before);}
try{
 await pg.exec(botDemoRetryFixture());
 const first=args(),id=await submit(first);
 for(let n=0;n<6;n++)assert.equal(await submit(first),id,'sixth exact retry is not a sixth intent');
 assert.deepEqual((await q('select attempts from icash_request_limits')).rows,[{attempts:1},{attempts:1}]);
 for(let n=0;n<4;n++)assert.notEqual(await submit(args()),id);
 const full=await snapshot();await rejectsUnchanged(args(),e=>e.code==='PT429');
 assert.equal(full.leads.length,5);assert.equal(await submit(first),id,'valid old retry still works at cap');
 assert.deepEqual(await snapshot(),full,'retry does not advance bucket window, intake time or consent');
 assert.equal(await submit(first.map((v,i)=>i===11?'e'.repeat(64):v)),id,'same valid retry may change trusted IP');
 assert.deepEqual(await snapshot(),full,'cross-IP retry creates no new-intent bucket');
 await rejectsUnchanged(args().map((v,i)=>i===11?'f'.repeat(64):v),e=>e.code==='PT429');
 for(const [index,value] of [[0,randomUUID()],[1,randomUUID()],[2,null],[3,'f'.repeat(64)],[4,'Other Seller'],[5,'99 Other Lane, Dallas, TX 75201'],[6,'+12145550124'],[7,false],[9,'America/New_York'],[10,'invalid'],[11,'invalid']]){
  await rejectsUnchanged(first.map((v,i)=>i===index?value:v));
 }
 await q("update icash_seller_intakes set attribution=attribution||'{\"source\":\"other_source\"}' where id=$1",[id]);
 await rejectsUnchanged(first,/retry mismatch/);
 await reset();
 // Preserve quota already consumed by the old route, never initialize a fresh
 // five-intent namespace at rollout. IP and user denial each roll back both.
 for(const key of [ipKey,userKey])await q('insert into icash_request_limits values($1,now(),4)',[key]);
 const fifth=args();await submit(fifth);await rejectsUnchanged(args(),e=>e.code==='PT429');
 await reset();await q('insert into icash_request_limits values($1,now(),5)',[ipKey]);
 await rejectsUnchanged(args(),e=>e.code==='PT429');assert.equal((await snapshot()).limits.length,1);
 await reset();await q('insert into icash_request_limits values($1,now(),5)',[userKey]);
 await rejectsUnchanged(args(),e=>e.code==='PT429');assert.equal((await snapshot()).limits.length,1);
 await reset();await rejectsUnchanged(args().map((v,i)=>i===7?false:v),/Valid demo consent/);
 assert.deepEqual(await snapshot(),{limits:[],leads:[]},'invalid new payload rolls back both budget charges');
 // An original transaction whose response was lost might have committed or
 // rolled back. Neither recovery path may produce two intakes or two charges.
 const unknown=args();await pg.exec('begin');await submit(unknown);await pg.exec('rollback');
 const recovered=await submit(unknown);assert.equal(await submit(unknown),recovered);
 assert.deepEqual((await q('select attempts from icash_request_limits')).rows,[{attempts:1},{attempts:1}]);
 await q("update icash_request_limits set window_start=now()-interval '2 hours',attempts=5");
 const old=await snapshot();assert.equal(await submit(unknown),recovered);assert.deepEqual(await snapshot(),old,'old retry never renews hourly allowance');
 await submit(args());assert.deepEqual((await q('select attempts from icash_request_limits')).rows,[{attempts:1},{attempts:1}]);
 const signature='public.icash_submit_limited_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text,text)';
 for(const role of ['anon','authenticated'])assert.equal((await one('select has_function_privilege($1,$2,\'execute\') allowed',[role,signature])).allowed,false);
 assert.equal((await one('select has_function_privilege(\'service_role\',$1,\'execute\') allowed',[signature])).allowed,true);
 const before=await snapshot();await pg.exec(readFileSync(new URL('../config/bot-demo-retry-accounting.sql',import.meta.url),'utf8'));assert.deepEqual(await snapshot(),before,'idempotent install leaves historical buckets and receipts intact');
 console.log('PASS demo accounting: unchanged5/hour budgets, exact retries at cap, cross-IP/account/source/payload rejection, both refusal rollbacks, expired-window and lost-response recovery, private ACLs.');
}finally{await pg.close();}
