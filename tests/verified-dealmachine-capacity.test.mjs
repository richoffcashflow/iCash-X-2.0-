import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/verified-dealmachine-capacity.sql'),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
try{
 await db.exec(`create schema icash_research_private;
 create table public.icash_dealmachine_request_budget(id integer primary key,minute_start timestamptz,minute_used integer,day_start timestamptz,day_used integer,minute_limit integer check(minute_limit between 1 and 60),day_limit integer check(day_limit between 1 and 5000));
 create table icash_research_private.requests(id uuid primary key,admitted boolean,created_at timestamptz,finished_at timestamptz,result jsonb);
 create table icash_research_private.quota_feedback(id integer primary key,request_id uuid,request_started_at timestamptz,headers jsonb,blocked_until timestamptz);
 create table public.icash_integration_checks(provider text primary key,checked_at timestamptz,result jsonb);
 insert into public.icash_dealmachine_request_budget values(1,now(),17,now()-interval '10 hours',3586,50,4900);
 insert into icash_research_private.requests select gen_random_uuid(),true,now()-make_interval(secs=>n),now(),'{"httpStatus":200,"minuteLimit":70,"dayLimit":10000}' from generate_series(1,2) n;
 insert into icash_research_private.quota_feedback select 1,id,created_at,result,null from icash_research_private.requests order by created_at desc limit 1;`);
 const before=await v('select to_jsonb(b) from icash_dealmachine_request_budget b');
 for(const mutation of ["update icash_research_private.requests set admitted=false","update icash_research_private.requests set finished_at=null","update icash_research_private.quota_feedback set headers='{}'","update icash_research_private.requests set result='{}'","update icash_research_private.quota_feedback set blocked_until=now()+interval '1 minute'","update icash_research_private.requests set created_at=now()-interval '2 hours'","update icash_dealmachine_request_budget set minute_limit=49"]){
  await db.exec('begin;'+mutation);await assert.rejects(db.exec(sql.replace(/^begin;$/m,'').replace(/^commit;$/m,'')));await db.exec('rollback;');
 }
 await db.exec(sql);
 const after=await v('select to_jsonb(b) from icash_dealmachine_request_budget b');assert.deepEqual({...after,minute_limit:50,day_limit:4900},before);
 assert.equal(after.minute_limit,60);assert.equal(after.day_limit,9800);assert.equal(await v('select count(*)::integer from icash_integration_checks'),1);
 await assert.rejects(db.exec(sql),/limits changed/);await db.exec('rollback');
 assert.equal(await v('select day_used from icash_dealmachine_request_budget'),3586);
 console.log('PASS quota adoption: fresh matching provider entitlement, backoff/changed-config guards, unchanged counters/windows, one audit and no implicit reset.');
}finally{await db.close();}
