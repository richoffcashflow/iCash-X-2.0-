import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function verifyWebinarIntelligence(q,config,webinar,secondWebinar){
 const settings=(await q('select config from icash_webinar_settings where id=1')).rows[0].config;
 assert.equal(settings.optimizer.enabled,true);
 await q('select icash_webinar_intelligence_settings(false)');
 const paused=(await q('select config from icash_webinar_settings where id=1')).rows[0].config;
 assert.deepEqual(paused,{...settings,optimizer:{...settings.optimizer,enabled:false}},'Toggle changes no other settings');
 await q('select icash_webinar_intelligence_settings(true)');
 const visitor=randomUUID(),first=randomUUID(),next=randomUUID(),pool='a'.repeat(64);
 await q('insert into icash_webinar_visitors(id) values($1)',[visitor]);
 const assignment={ad_key:'ad:12345',context_key:'new:day',pool_key:pool,baseline_key:webinar+':1:day',mode:'learning',probability:.5,policy_version:1};
 const begin=async(id,w=webinar,meta=assignment,advance=null)=>(await q('select to_jsonb(icash_webinar_begin_intelligent($1,$2,$3,$4,$5)) as value',[visitor,id,{...config,id:w,recordingVersion:w===webinar?'day':'night'},meta,advance])).rows[0].value;
 assert.equal((await begin(first)).id,first);
 const raced=await begin(randomUUID(),secondWebinar,{...assignment,ad_key:'ad:67890'});
 assert.equal(raced.id,first,'Different candidate and ad in another tab preserve the first assignment');assert.equal(raced.config.recordingVersion,'day');
 assert.equal(Number((await q('select count(*) as n from icash_webinar_assignments where visitor_id=$1',[visitor])).rows[0].n),1);
 assert.equal((await q('select ad_key from icash_webinar_assignments where session_id=$1',[first])).rows[0].ad_key,'ad:12345');
 const advance={...assignment,context_key:'returning:night',mode:'single',probability:1};
 assert.equal((await begin(next,secondWebinar,advance,first)).id,next);
 assert.equal((await begin(randomUUID(),webinar,assignment,first)).id,next,'Duplicate advance calls cannot start a third experiment');
 const old=(await q('select superseded_at,completed_at from icash_webinar_sessions where id=$1',[first])).rows[0];assert.ok(old.superseded_at);assert.equal(old.completed_at,null);
 const intelligenceReport=async(context='new:day',ad='ad:55555')=>(await q('select icash_webinar_intelligence_report($1,$2) as value',[context,ad])).rows[0].value;
 async function sample({hours=48,mode='learning',ad='ad:55555',context='new:day',version='day',v=randomUUID(),preview=false,revision=1,watched=40}={}){
  const s=randomUUID(),guest='intelligence-'+v;
  await q('insert into icash_webinar_visitors(id,funding_guest_hash) values($1,$2) on conflict do nothing',[v,guest]);
  await q("insert into icash_webinar_sessions(id,visitor_id,webinar_id,revision,config,is_preview,created_at,completed_at,watched_seconds) values($1,$2,$3,$4,$5,$6,now()-$7*interval '1 hour',now(),$8)",[s,v,webinar,revision,{...config,recordingVersion:version},preview,hours,watched]);
  await q("insert into icash_webinar_assignments(session_id,visitor_id,webinar_id,revision,recording_version,ad_key,context_key,pool_key,baseline_key,mode,probability,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,.5,now()-$11*interval '1 hour')",[s,v,webinar,revision,version,ad,context,pool,webinar+':1:day',mode,hours]);
  await q("insert into icash_webinar_events(visitor_id,session_id,kind,event_key,created_at) values($1,$2,'started','once',now()-$3*interval '1 hour')",[v,s,hours]);
  return {v,s,guest};
 }
 async function pay(sample,cents,hours,mode='live'){
  const payment='pi_'+randomUUID();
  await q("insert into icash_funding_orders(id,mode,state,guest_hash,price_cents,tax_cents,paid_at,stripe_payment_id) values($1,$2,'paid',$3,$4,0,now()-$5*interval '1 hour',$6)",[randomUUID(),mode,sample.guest,cents,hours,payment]);return payment;
 }
 const learn=await sample(),holdout=await sample({mode:'holdout'}),exploit=await sample({mode:'winner'}),fresh=await sample({hours:1}),preview=await sample({preview:true});
 const refunded=await pay(learn,2000,47);await pay(learn,3000,46);await pay(learn,90000,1);await pay(learn,80000,47,'test');await pay(holdout,4000,47);await pay(exploit,5000,47);await pay(fresh,6000,.5);await pay(preview,7000,47);
 const repeat=await sample({v:learn.v,hours:2});await pay(repeat,8000,1);
 let report=await intelligenceReport(),row=report.rows.find(r=>r.ad_key==='ad:55555'&&r.revision===1&&r.recording_version==='day');
 assert.equal(row.visitors,4,'Preview and repeat assignments do not inflate the cohort');assert.equal(row.mature_visitors,3,'Fresh visits get a complete observation window');
 assert.equal(row.buyers,3);assert.equal(row.revenue_cents,14000,'Only payments in each first-assignment 24-hour window count');
 assert.equal(row.learning_visitors,1);assert.equal(row.learning_buyers,1);assert.equal(row.learning_value_cents,5000);assert.equal(row.learning_value_squares,25000000,'Variance uses each visitor’s combined purchases');assert.equal(row.average_watch_seconds,40);
 const comparison=report.comparisons[0];assert.equal(comparison.holdout_visitors,1);assert.equal(comparison.adaptive_visitors,2);assert.equal(comparison.holdout_value_cents,4000);assert.equal(comparison.adaptive_value_cents,10000);
 await q('insert into icash_billing_reviews(payment_id) values($1)',[refunded]);
 row=(await intelligenceReport()).rows.find(r=>r.ad_key==='ad:55555');assert.equal(row.learning_value_cents,3000);assert.equal(row.learning_value_squares,9000000);
 await sample({version:'night',context:'new:night'});await sample({revision:2});await sample({hours:800});await sample({ad:'ad:66666',v:learn.v,hours:1});
 assert.equal((await intelligenceReport('new:night')).rows.find(r=>r.ad_key==='ad:55555').recording_version,'night');
 assert.equal((await intelligenceReport()).rows.find(r=>r.ad_key==='ad:55555'&&r.revision===2).visitors,1);
 const global=(await intelligenceReport('new:day','*')).rows;
 assert.equal(global.reduce((n,r)=>n+r.visitors,0),6,'Shared cohorts count a visitor once across ads; old assignments age out');
 await assert.rejects(()=>intelligenceReport('bad'));await assert.rejects(()=>intelligenceReport('new:day','a name'));
 for(const role of ['anon','authenticated']){
  assert.equal((await q("select has_table_privilege($1,'icash_webinar_assignments','select') as ok",[role])).rows[0].ok,false);
  for(const signature of ['icash_webinar_begin_intelligent(uuid,uuid,jsonb,jsonb,uuid)','icash_webinar_intelligence_report(text,text)','icash_webinar_intelligence_settings(boolean)'])assert.equal((await q('select has_function_privilege($1,$2,\'execute\') as ok',[role,signature])).rows[0].ok,false);
 }
 assert.equal((await q("select has_function_privilege('service_role','icash_webinar_intelligence_report(text,text)','execute') as ok")).rows[0].ok,true);
 console.log('Intelligence database checks passed: atomic resume/advance, immutable ad assignment, 24-hour cohorts, randomized-only learning, control comparison, Day/Night/revisions, repeats, refunds, test exclusion and private permissions.');
}
