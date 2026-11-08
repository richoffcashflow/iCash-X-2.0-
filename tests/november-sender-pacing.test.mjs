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
 const room=(phone,time=at,cold=true)=>one('select icash_sender_private.november_room($1,$2,$3)',[phone,cold,time]);
 const seed=(phone,n,age)=>db.query("insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) select 'fixture',gen_random_uuid(),$1,true,$2::timestamptz-$3::interval from generate_series(1,$4::int)",[phone,at,age,n]);
 for(const phone of novemberBusinessPhones){
  await db.exec('truncate icash_sender_private.uses');assert.equal(await room(phone),true);
  for(const time of ['2026-11-08T07:00:00Z','2026-11-08T13:59:59Z','2026-11-09T02:00:00Z'])assert.equal(await room(phone,time),false,'Cold sends cannot run overnight or at 9 PM');
  assert.equal(await room(phone,'2026-11-08T14:00:00Z'),true);
  assert.equal(await room(phone,'2026-11-08T07:00:00Z',false),true,'Existing requested-conversation rules remain separate');
  await seed(phone,1,'4 minutes 59 seconds');assert.equal(await room(phone),false);
  await db.exec('truncate icash_sender_private.uses');await seed(phone,1,'5 minutes');assert.equal(await room(phone),true);
  await seed(phone,9,'30 minutes');assert.equal(await room(phone),false,'Ten in an hour cannot burst');
  await db.exec('truncate icash_sender_private.uses');await seed(phone,99,'2 hours');assert.equal(await room(phone),true);
  await seed(phone,1,'2 hours');assert.equal(await room(phone),false,'New lines remain capped at 100 even when a list qualifies for 300');
  assert.equal(await room('+14155550100'),true,'Unrelated number keeps its existing policy');
 }
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_sender_private.november_room(text,boolean,timestamptz)','execute')",[role]),false);
 const definition=await one("select pg_get_functiondef('icash_sender_private.room(text,boolean,uuid,text)'::regprocedure)");
 assert.match(definition,/november_room\(p_sender,p_cold,at_time\)/);
 console.log('PASS November pacing: 2 AM exclusion, exact opening/closing hours, five-minute spacing, rolling hourly/daily limits, separate transactional traffic and private access.');
}finally{await db.close();}
