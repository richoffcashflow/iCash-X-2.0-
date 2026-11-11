import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {novemberBusinessPhones} from '../lib/business-phone-policy.ts';
const db=await PGlite.create(),read=p=>readFileSync(p,'utf8');
const one=async(sql,p=[])=>Object.values((await db.query(sql,p)).rows[0])[0];
const at='2026-11-08T17:00:00Z';
try{
 await db.exec(read('tests/fixtures/contiguity-volume-predecessors.sql')+read('tests/fixtures/contiguity-volume-admission.sql'));
 await db.exec(read('supabase/migrations/'+readdirSync('supabase/migrations').find(p=>p.endsWith('_contiguity_sender_volume.sql'))));
 await db.exec(read('config/november-sender-pacing.sql'));
 const seed=(phone,n,age,cold=true)=>db.query("insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) select 'fixture',gen_random_uuid(),$1,$5,$2::timestamptz-$3::interval from generate_series(1,$4::int)",[phone,at,age,n,cold]);
 await seed(novemberBusinessPhones[0],100,'2 hours');
 const before=await one('select jsonb_agg(u order by source_id) from icash_sender_private.uses u');
 const takeBefore=await one("select pg_get_functiondef('icash_sender_private.take(text,uuid,text,boolean,uuid,uuid,text,boolean)'::regprocedure)");
 const migration=read('supabase/migrations/'+readdirSync('supabase/migrations').find(p=>p.endsWith('_november_sender_200.sql')));
 assert.equal(migration,read('config/november-sender-200.sql'));
 await db.exec(migration);
 await db.exec(read('config/november-additional-sender-pacing.sql'));
 await db.exec(read('config/november-11-sender-pacing.sql'));
 assert.deepEqual(await one('select jsonb_agg(u order by source_id) from icash_sender_private.uses u'),before,'Existing usage survives the limit change');
 assert.equal(await one("select pg_get_functiondef('icash_sender_private.take(text,uuid,text,boolean,uuid,uuid,text,boolean)'::regprocedure)"),takeBefore,'Shared locking and admission receipts are unchanged');
 // Freeze only the clock in the real shared gate, after checking its predecessor.
 const definition=await one("select pg_get_functiondef('icash_sender_private.room(text,boolean,uuid,text)'::regprocedure)");
 await db.exec(definition.replace('statement_timestamp()',`'${at}'::timestamptz`));
 const shared=(phone,cold=true)=>one('select icash_sender_private.room($1,$2)',[phone,cold]);
 assert.equal(await shared(novemberBusinessPhones[0]),true,'The shared baseline no longer stops these lines at 100');
 const room=(phone,time=at,cold=true)=>one('select icash_sender_private.november_room($1,$2,$3)',[phone,cold,time]);
 for(const phone of novemberBusinessPhones){
  await db.exec('truncate icash_sender_private.uses');assert.equal(await room(phone),true);
  for(const time of ['2026-11-08T07:00:00Z','2026-11-08T13:59:59Z','2026-11-09T02:00:00Z'])assert.equal(await room(phone,time),false,'Cold sends cannot run overnight or at 9 PM');
  assert.equal(await room(phone,'2026-11-08T14:00:00Z'),true);
  assert.equal(await room(phone,'2026-11-08T07:00:00Z',false),true,'Existing requested-conversation rules remain separate');
  await seed(phone,1,'2 minutes 59 seconds');assert.equal(await room(phone),false);assert.equal(await shared(phone),false);
  await db.exec('truncate icash_sender_private.uses');await seed(phone,1,'3 minutes');assert.equal(await room(phone),true);assert.equal(await shared(phone),true);
  await seed(phone,18,'30 minutes');assert.equal(await shared(phone),true,'The twentieth hourly slot is available');
  await seed(phone,1,'30 minutes');assert.equal(await room(phone),false);assert.equal(await shared(phone),false,'Twenty in an hour cannot burst');
  await db.exec('truncate icash_sender_private.uses');await seed(phone,20,'1 hour');assert.equal(await shared(phone),true,'Exact hourly boundary ages out');
  await db.exec('truncate icash_sender_private.uses');await seed(phone,199,'2 hours');assert.equal(await room(phone),true);assert.equal(await shared(phone),true,'No hidden 100/day gate');
  await seed(phone,1,'2 hours');assert.equal(await room(phone),false);assert.equal(await shared(phone),false,'These lines stop at 200');
  assert.equal(await one("select icash_sender_private.room($1,true,md5('owner')::uuid,'TX/active')",[phone]),false,'A cohort cannot bypass the exact-number ceiling');
  assert.equal(await shared(phone,false),true,'Cold daily ceiling leaves transactional headroom');
  await seed(phone,799,'2 hours',false);assert.equal(await shared(phone,false),true);
  await seed(phone,1,'2 hours',false);assert.equal(await shared(phone,false),false,'The shared 1,000-total ceiling still applies');
  await db.exec('truncate icash_sender_private.uses');await seed(phone,200,'24 hours');assert.equal(await shared(phone),true,'Exact daily boundary ages out');
  assert.equal(await room('+14155550100'),true,'Unrelated number keeps its existing policy');
 }
 await seed('+14155550100',100,'2 hours');assert.equal(await shared('+14155550100'),false,'Unrelated numbers still need verified replies above 100');
 for(const signature of ['icash_sender_private.november_room(text,boolean,timestamptz)','icash_sender_private.room(text,boolean,uuid,text)']){
  for(const role of ['anon','authenticated'])assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
  assert.equal(await one('select has_function_privilege(\'service_role\',$1,\'execute\')',[signature]),true);
 }
 assert.match(definition,/november_room\(p_sender,p_cold,at_time\)/);
 console.log('PASS November pacing: preserved counters, quiet hours, three-minute spacing, 20/hour and effective 200/day, unchanged unrelated baseline, 1,000 total and private access.');
}finally{await db.close();}
