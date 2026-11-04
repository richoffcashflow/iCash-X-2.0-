import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {collectSupportQuality} from '../lib/support-quality.ts';
const pg=new PGlite(),now=new Date('2026-11-04T12:00:00Z');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const calls=[];
try{
 await pg.exec(`create table icash_support_threads(id uuid primary key,subject text,status text,created_at timestamptz,updated_at timestamptz);
 create table icash_access_help_requests(id uuid primary key,status text,created_at timestamptz,updated_at timestamptz);
 create table icash_support_messages(id uuid primary key,thread_id uuid,role text,content text,created_at timestamptz);
 create table icash_access_help_messages(id uuid primary key,request_id uuid,role text,content text,created_at timestamptz);`);
 // More than two pages, including shared creation timestamps and untouched old cases.
 for(let n=1;n<=26;n++)await pg.query("insert into icash_support_threads values($1,'Saved issue','open','2026-10-01','2026-10-02')",[id(n)]);
 for(let n=101;n<=113;n++)await pg.query("insert into icash_access_help_requests values($1,'open','2026-10-01','2026-10-02')",[id(n)]);
 await pg.query("insert into icash_support_threads values($1,'Closed history','closed','2026-10-01','2026-11-04')",[id(90)]);
 for(let n=1;n<=45;n++)await pg.query("insert into icash_support_messages values($1,$2,'assistant','Please do not share the code itself.','2026-10-02'::timestamptz+($3*interval '1 minute'))",[id(200+n),id(1),n]);
 await pg.query("insert into icash_support_messages values($1,$2,'user','The bot stopped calling','2026-10-02')",[id(300),id(2)]);
 // Execute the actual collector's PostgREST filters against PostgreSQL with a
 // deliberately small parameterized adapter. No account data or network calls.
 const db=async(path,method,body)=>{
  assert.equal(method,undefined);assert.equal(body,undefined);calls.push(path);
  const [table,search]=path.split('?');assert.match(table,/^icash_(?:support_threads|access_help_requests|support_messages|access_help_messages)$/);
  const params=new URLSearchParams(search),values=[],where=[];
  const bind=v=>{values.push(v);return '$'+values.length;};
  for(const [key,value] of params){
   if(['select','order','limit'].includes(key))continue;
   if(key==='or'){
    const match=/^\(created_at.gt.(.+),and\(created_at.eq.(.+),id.gt.([0-9a-f-]+)\)\)$/.exec(value);assert(match);assert.equal(match[1],match[2]);
    where.push(`(created_at,id)>(${bind(match[1])}::timestamptz,${bind(match[3])}::uuid)`);continue;
   }
   assert(['created_at','updated_at','status','role','thread_id','request_id'].includes(key));
   const dot=value.indexOf('.'),op=value.slice(0,dot),v=value.slice(dot+1);
   if(op==='in'){const items=v.slice(1,-1).split(',');where.push(`${key} in (${items.map(bind).join(',')})`);}
   else{assert(['eq','gte','lte'].includes(op));where.push(`${key}${{eq:'=',gte:'>=',lte:'<='}[op]}${bind(v)}`);}
  }
  const order=params.get('order');assert(['created_at.asc,id.asc','created_at.desc,id.desc'].includes(order));
  const limit=Number(params.get('limit'));assert([11,41].includes(limit));
  return (await pg.query(`select to_jsonb(r) as row from ${table} r where ${where.join(' and ')} order by ${order.replaceAll('.',' ')} limit ${limit}`,values)).rows.map(r=>r.row);
 };
 const seen=new Set();let cursor;let page=0;
 do{
  const start=calls.length,report=await collectSupportQuality(db,now,{cursor});page++;
  assert.equal(report.page.scope,'unresolved');assert(report.sampled<=20);assert(calls.length-start<=22);
  for(const item of report.cases){assert(!seen.has(item.id),'A stable old case must not repeat between pages');seen.add(item.id);assert.equal(item.status,'open');}
  if(page===1){
   assert.equal(report.page.messagesLimited,true);
   assert.equal(report.cases.find(c=>c.id===id(2)).question,'The bot stopped calling','Verbose peers cannot consume this case’s history');
   // A reply changes updated_at but cannot move an unseen case behind a cursor.
   await pg.query("update icash_support_threads set updated_at='2026-11-04' where id=$1",[id(15)]);
   // A newly created case is picked up on restart, not inserted into this snapshot.
   await pg.query("insert into icash_support_threads values($1,'New','open','2026-11-04T12:00:01Z','2026-11-04T12:00:01Z')",[id(99)]);
  }
  cursor=report.page.nextCursor;
 }while(cursor);
 assert.equal(page,3);assert.equal(seen.size,39);assert(!seen.has(id(90)));assert(!seen.has(id(99)));
 const recent=await collectSupportQuality(db,now,{scope:'recent'});assert.equal(recent.sampled,2,'Recent history remains independent of the unresolved backlog');
 const restart=await collectSupportQuality(db,new Date('2026-11-04T12:00:02Z'));assert(restart.page.nextCursor);
 for(const raw of ['{}','null','{"version":1,"scope":"unresolved","snapshotAt":"2026-11-04T12:00:00Z","account":{"at":"x),or=(true","id":"x"},"access":null}', 'x'.repeat(1201)]){
  const before=calls.length;await assert.rejects(()=>collectSupportQuality(db,now,{cursor:raw}),/Invalid support quality cursor/);assert.equal(calls.length,before,'Invalid cursors cannot reach the database');
 }
 await assert.rejects(()=>collectSupportQuality(db,now,{scope:'arbitrary'}),/Invalid support quality scope/);
 console.log('PASS support quality pagination: all old unresolved account and guest cases, stable keysets, bounded isolated histories, recent history, malformed cursor rejection, no mutations.');
}finally{await pg.close();}
