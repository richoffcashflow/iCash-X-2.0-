// Real SQL over synthetic receipts in isolated PostgreSQL. No provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID as uuid} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args);
try{
 await pg.exec('create role anon;create role authenticated;create role service_role;');
 const names=['icash_accounts','icash_screening_jobs','icash_voice_jobs','icash_live_conversations','icash_operation_spend','icash_call_recordings','icash_deal_files','icash_text_messages','icash_text_threads','icash_deal_emails','icash_contact_permissions','icash_operational_contacts'];
 const fixture=JSON.parse(read('tests/fixtures/automatic-credits-baseline.json'));
 for(const table of fixture.tables.filter(t=>names.includes(t.name)))await pg.exec(table.definition.replace(/default icash_[a-z_]+\.clock_now\(\)/g,'default now()'));
 await pg.exec(read('supabase/migrations/20261005211700_workspace_activity_report.sql'));
 await pg.exec('create table icash_timezone_names(name text primary key);insert into icash_timezone_names select name from pg_timezone_names;');
 await pg.exec(`create table icash_seller_email_openers(account_id uuid,deal_id uuid,email_id uuid,recipient text);
 create table icash_prospecting_budgets(id bigserial primary key,account_id uuid,created_at timestamptz default now());`);
 const response=read('config/opportunity-engine.sql').match(/create function public\.icash_call_has_seller_response[\s\S]*?\$\$;/)[0];
 await pg.exec(response);
 await pg.exec(read('config/seller-response-policy.sql'));
 await pg.exec(read('config/opportunity-progress-report.sql'));
 const a=uuid(),b=uuid();await q('insert into icash_accounts(id) values($1),($2)',[a,b]);
 const report=async(days=1,zone='America/Chicago',account=a)=>(await q('select icash_opportunity_progress_report($1,$2,$3) r',[account,days,zone])).rows[0].r;
 const values=r=>[r.screened,r.eligible,r.contacted,r.responded,r.queued];
 const blank=await report(),today=Date.parse(blank.startAt),now=Date.parse(blank.endAt),day=86400000,stamp=n=>new Date(n).toISOString();
 assert.deepEqual(values(blank),[0,0,0,0,0],'a real account with no budget has a valid empty report');
 const screen=async(property,time,{account=a,state='complete',eligible=true,practice=false,snapshotProperty=property}={})=>{
  const id=uuid();await q('insert into icash_screening_jobs(id,account_id,state,snapshot,result,created_at,completed_at) values($1,$2,$3,$4,$5,$6,$6)',[id,account,state,{propertyId:snapshotProperty,practice},{property:{propertyId:property},financialCheck:{status:eligible?'eligible':'ineligible'}},stamp(time)]);return id;
 };
 const fresh=await screen('fresh',today),week=await screen('week',today-2*day),month=await screen('month',today-12*day),old=await screen('old',today-40*day);
 await screen('fresh',now-1);await screen('old',now-1); // Duplicate/reanalysis is not a new property.
 const bad=await screen('ineligible',today,{eligible:false});
 const practice=await screen('practice_test',today),practiceFlag=await screen('flagged',today,{practice:true}),practiceConflict=await screen('real_result',today,{snapshotProperty:'practice_snapshot'});
 await screen('future',now+day);await screen('other',today,{account:b});await screen('queue',today-40*day,{state:'queued'});await screen('practice_queue',today,{state:'queued'});
 const conversation=async(screening,time,{account=a,message='Yes, tell me about your offer',party='seller',state='complete',provider=true,optedOut=false,key=uuid(),created=time}={})=>{
  await q('insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,conversation_id,state,result,created_at,completed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[uuid(),account,screening,party,key,provider?uuid():null,state,{transcript:[{role:'user',message}],optedOut},stamp(created),stamp(time)]);return key;
 };
 await conversation(old,today);await conversation(old,today); // Two calls on one old property count once.
 await conversation(week,today-2*day);await conversation(month,today-12*day);
 await conversation(fresh,today,{message:'Leave a message after the beep'});
 await conversation(practice,today);await conversation(practiceFlag,today);await conversation(practiceConflict,today);
 await conversation(bad,today,{party:'buyer'});await conversation(bad,today,{provider:false});
 await conversation(bad,today,{account:b});await conversation(bad,now+day);
 const dealFor=async(screening,{account=a,practice=false}={})=>{const id=uuid();await q('insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,$4)',[id,account,screening,{practice}]);return id;};
 const threadFor=async(deal,{account=a,party='seller'}={})=>{const id=uuid();await q('insert into icash_text_threads(id,account_id,deal_id,party) values($1,$2,$3,$4)',[id,account,deal,party]);return id;};
 const oldDeal=await dealFor(old),oldThread=await threadFor(oldDeal);
 const text=async(thread,time,{account=a,direction='outgoing',state='accepted',provider=true,event=false,body='What is your price?'}={})=>{
  const id=uuid();await q('insert into icash_text_messages(id,account_id,thread_id,direction,state,provider_id,event_id,body,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,account,thread,direction,state,provider?uuid():null,event?uuid():null,body,stamp(time)]);return id;
 };
 await text(oldThread,today);await text(oldThread,today,{direction:'incoming',state:'received',provider:false,event:true});
 const badDeal=await dealFor(bad),badThread=await threadFor(badDeal);
 await text(badThread,today,{state:'ready',provider:false});await text(badThread,today,{provider:false});
 await text(badThread,today,{direction:'incoming',state:'received',provider:false});
 await text(badThread,today,{account:b});await text(await threadFor(badDeal,{party:'buyer'}),today);
 await text(await threadFor(await dealFor(await screen('ineligible',today,{eligible:false}),{practice:true})),today);
 assert.deepEqual(values(await report(1)),[2,1,2,1,1]);
 assert.deepEqual(values(await report(7)),[3,2,3,2,1]);
 assert.deepEqual(values(await report(30)),[4,3,4,3,1]);
 // A funding event must not reset history or follow-up activity.
 const before=values(await report(7));await q('insert into icash_prospecting_budgets(account_id) values($1),($1)',[a]);
 assert.deepEqual(values(await report(7)),before);
 // The send date, not an older queued draft date, determines the selected period.
 const delayed=await text(badThread,today-12*day);
 await q('insert into icash_operation_spend(operation_key,account_id,dispatched_at) values($1,$2,$3)',['text:'+delayed,a,stamp(today)]);
 assert.equal((await report()).contacted,3);
 await text(badThread,today,{direction:'incoming',state:'received',body:'Please stop texting me'});
 assert.equal((await report()).responded,1,'STOP is not counted as a seller response');
 await text(oldThread,today,{direction:'incoming',state:'received',body:'STOP'});
 assert.equal((await report()).responded,0,'cross-channel opt-out removes the property response');
 // A carrier receipt proves an attempted call even before a transcript is saved.
 const carrier=await screen('carrier',today-40*day);
 await q('insert into icash_call_recordings(id,account_id,screening_id,party,call_sid,provider_started_at) values($1,$2,$3,$4,$5,$6)',[uuid(),a,carrier,'seller','CA_synthetic',stamp(today)]);
 assert.equal((await report()).contacted,4);
 await q('update icash_call_recordings set provider_started_at=null,dial_claimed_at=$1 where call_sid=$2',[stamp(today),'CA_synthetic']);
 assert.equal((await report()).contacted,4,'a canonical carrier call counts even when no recording ever starts');
 await q('update icash_call_recordings set call_sid=null where screening_id=$1',[carrier]);
 assert.equal((await report()).contacted,3,'a dial claim without a carrier receipt is not completed outreach');
 await q('update icash_call_recordings set call_sid=$1 where screening_id=$2',['CA_synthetic',carrier]);
 // Email replies require the exact assigned seller opener, account, deal and recipient.
 const emailScreen=await screen('email',today-40*day),emailDeal=await dealFor(emailScreen),opener=uuid();
 await q('insert into icash_seller_email_openers values($1,$2,$3,$4)',[a,emailDeal,opener,'seller@example.test']);
 const email=async(id,time,{direction='outgoing',state='accepted',replyTo=null,recipient='seller@example.test',provider=true,account=a,body='What is the offer?'}={})=>q('insert into icash_deal_emails(id,account_id,deal_id,direction,state,provider_id,reply_to_id,recipient,body_text,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,account,emailDeal,direction,state,provider?uuid():null,replyTo,recipient,body,stamp(time)]);
 await email(opener,today);await email(uuid(),today,{direction:'incoming',state:'received',replyTo:opener});
 assert.deepEqual([(await report()).contacted,(await report()).responded],[5,1]);
 await email(uuid(),today,{direction:'incoming',state:'received',replyTo:opener,recipient:'wrong@example.test',body:'STOP'});
 await email(uuid(),today,{direction:'incoming',state:'received',replyTo:opener,account:b,body:'STOP'});
 assert.equal((await report()).responded,1);
 await email(uuid(),today,{direction:'incoming',state:'received',replyTo:opener,body:'Please unsubscribe'});
 assert.equal((await report()).responded,0);
 const jobScreen=await screen('job_only',today-40*day),permission=uuid();
 await q('insert into icash_contact_permissions(id,account_id,screening_id,party) values($1,$2,$3,$4)',[permission,a,jobScreen,'seller']);
 await q('insert into icash_voice_jobs(id,account_id,permission_id,provider_call_sid,created_at) values($1,$2,$3,$4,$5)',[uuid(),a,permission,'CA_job_only',stamp(today)]);
 assert.equal((await report()).contacted,6,'saved carrier admission counts before callback projections');
 await q('update icash_contact_permissions set account_id=$1 where id=$2',[b,permission]);
 assert.equal((await report()).contacted,5,'mismatched permission cannot bind another account property');
 const weekly=await report(7),activity=(await q('select icash_activity_report($1,7,$2) r',[a,'America/Chicago'])).rows[0].r;
 assert.equal(weekly.startAt,activity.startAt);
 assert.equal(weekly.screened,activity.leads-1,'unique new properties agree except the legacy report accepts one conflicting practice snapshot');
 for(const days of [0,2,31,null])await assert.rejects(report(days));await assert.rejects(report(1,'No/Such_Zone'));
 assert.equal(await report(1,'UTC',uuid()),null);
 assert.notEqual((await report(1,'Pacific/Kiritimati')).startAt,(await report(1,'UTC')).startAt);
 assert.equal((await q("select has_function_privilege('authenticated','icash_opportunity_progress_report(uuid,integer,text)','execute') allowed")).rows[0].allowed,false);
 assert.equal((await q("select has_function_privilege('anon','icash_opportunity_progress_report(uuid,integer,text)','execute') allowed")).rows[0].allowed,false);
 await pg.exec('begin read only');await report();await pg.exec('rollback');
 console.log('PASS opportunity progress SQL: funding-independent history, shared 1/7/30 calendar windows, old-property follow-ups, distinct properties across channels, original evidence without outcome cache, queued/failed/future/practice exclusion, STOP, account isolation and read-only private access.');
}finally{await pg.close();}
