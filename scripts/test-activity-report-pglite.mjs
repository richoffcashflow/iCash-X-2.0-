// Real SQL in isolated PostgreSQL; synthetic records only, no provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const q=(sql,args=[])=>pg.query(sql,args);
try{
 await pg.exec('create role anon;create role authenticated;create role service_role;');
 const tables=['icash_accounts','icash_screening_jobs','icash_voice_jobs','icash_live_conversations','icash_operation_spend','icash_call_recordings','icash_deal_files','icash_text_messages','icash_text_threads'];
 const fixture=JSON.parse(read('tests/fixtures/automatic-credits-baseline.json'));
 for(const t of fixture.tables.filter(t=>tables.includes(t.name)))await pg.exec(t.definition.replace(/default icash_[a-z_]+\.clock_now\(\)/g,'default now()'));
 await pg.exec(read('supabase/migrations/20261005211700_workspace_activity_report.sql'));
 const a=uuid(),b=uuid();await q('insert into icash_accounts(id) values($1),($2)',[a,b]);
 const report=async(days=1,zone='America/Chicago',account=a)=>(await q('select icash_activity_report($1,$2,$3) r',[account,days,zone])).rows[0].r;
 const blank=await report();assert.deepEqual([blank.leads,blank.calls,blank.texts,blank.contracts],[0,0,0,0]);
 const now=Date.parse(blank.endAt),today=Date.parse(blank.startAt),stamp=ms=>new Date(ms).toISOString();
 const screen=async(property,time,account=a,state='complete')=>{const id=uuid();await q('insert into icash_screening_jobs(id,account_id,state,snapshot,result,completed_at) values($1,$2,$3,$4,$5,$6)',[id,account,state,{propertyId:property},{property:{propertyId:property}},stamp(time)]);return id;};
 const first=await screen('prop_first',today),old=await screen('prop_old',today-2*86400000),month=await screen('prop_month',today-12*86400000),practice=await screen('practice_example',today);
 await screen('prop_old',now-1);await screen('prop_first',now-1); // Reanalysis never becomes another lead.
 await screen('prop_future',now+86400000);await screen('prop_other',today,b);await screen('prop_queued',today,a,'queued');await screen('prop_ancient',today-40*86400000);
 const call=async(key,time,account=a)=>q("insert into icash_live_conversations(id,account_id,operation_key,conversation_id,created_at) values($1,$2,$3,$4,$5)",[uuid(),account,key,'conv_'+uuid(),stamp(time)]);
 await call('call_one',today);await call('call_week',today-3*86400000);await call('call_month',today-15*86400000);await call('call_other',today,b);
 await q("insert into icash_operation_spend(operation_key,account_id,dispatched_at) values('call_one',$1,$2)",[a,stamp(today)]);
 await q("insert into icash_voice_jobs(id,account_id,operation_key,provider_call_sid,created_at) values($1,$2,'call_one','CA_one',$3)",[uuid(),a,stamp(today)]);
 await q("insert into icash_call_recordings(id,account_id,operation_key,call_sid,provider_started_at) values($1,$2,'call_one','CA_one',$3)",[uuid(),a,stamp(today)]);
 await q("insert into icash_voice_jobs(id,account_id,operation_key,created_at) values($1,$2,'queued_only',$3)",[uuid(),a,stamp(today)]);
 await q("insert into icash_live_conversations(id,account_id,screening_id,operation_key,conversation_id,created_at) values($1,$2,$3,'practice_call','practice_conv',$4)",[uuid(),a,practice,stamp(today)]);
 const contract=async(screening,time,terms={})=>q("insert into icash_deal_files(id,account_id,screening_id,terms,seller_signed_at) values($1,$2,$3,$4,$5)",[uuid(),a,screening,terms,time===null?null:stamp(time)]);
 await contract(first,today);await contract(old,today-2*86400000);await contract(month,null);await contract(practice,today,{practice:true});
 const deal=(await q('select id from icash_deal_files where screening_id=$1',[first])).rows[0].id,thread=uuid();
 await q('insert into icash_text_threads(id,account_id,deal_id) values($1,$2,$3)',[thread,a,deal]);
 for(const [state,direction,age,provider] of [['accepted','outgoing',0,'p1'],['delivered','outgoing',2,'p2'],['accepted','outgoing',12,'p3'],['ready','outgoing',0,null],['received','incoming',0,'p4'],['needs_review','outgoing',0,null],['accepted','outgoing',0,null]])await q('insert into icash_text_messages(account_id,thread_id,state,direction,created_at,provider_id) values($1,$2,$3,$4,$5,$6)',[a,thread,state,direction,stamp(today-age*86400000),provider]);
 // An older queued draft counts on its actual send day.
 const delayed=uuid();await q("insert into icash_text_messages(id,account_id,thread_id,state,direction,created_at,provider_id) values($1,$2,$3,'accepted','outgoing',$4,'p5')",[delayed,a,thread,stamp(today-12*86400000)]);
 await q('insert into icash_operation_spend(operation_key,account_id,dispatched_at) values($1,$2,$3)',['text:'+delayed,a,stamp(today)]);
 assert.equal('spentCents' in blank,false,'compact activity returns only outcome metrics');
 const metrics=r=>[r.leads,r.calls,r.texts,r.contracts];
 assert.deepEqual(metrics(await report(1)),[1,1,2,1]);
 assert.deepEqual(metrics(await report(7)),[2,2,3,2]);
 assert.deepEqual(metrics(await report(30)),[3,3,4,2]);
 for(const days of [0,2,31,null])await assert.rejects(report(days));await assert.rejects(report(1,'No/Such_Zone'));
 assert.equal(await report(1,'UTC',uuid()),null);
 const local=await report(1,'Pacific/Kiritimati'),utc=await report(1,'UTC');assert.notEqual(local.startAt,utc.startAt,'Today starts at local midnight');
 assert.equal((await q("select has_function_privilege('authenticated','icash_activity_report(uuid,integer,text)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS activity report: local calendar windows, 1/7/30 days, account isolation, unique new leads, deduplicated calls, sent texts, signed contracts, practice/queued/future exclusion, no spend totals, and private access.');
}finally{await pg.close();}
