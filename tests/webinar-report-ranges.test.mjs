import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {validWebinarReport} from '../lib/webinar-reporting.ts';

// Execute both reporting implementations over the same isolated source data.
const pg=await PGlite.create();
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const clock=sql=>sql.replaceAll('now()',"'2026-11-16T18:00:00Z'::timestamptz");
const regular=sql=>sql.replaceAll('public.icash_webinar_sessions','public.icash_regular_webinar_sessions').replaceAll('public.icash_webinars','public.icash_regular_webinars');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const query=(sql,args=[])=>pg.query(sql,args);
const report=async(period,timezone)=>(await query('select icash_webinar_report_with_funnel($1,$2) r',[period,timezone])).rows[0].r;
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_timezone_names(name text);insert into icash_timezone_names values('America/Chicago'),('UTC'),('America/Los_Angeles');
 create table icash_webinars(id uuid primary key,config jsonb,updated_at timestamptz);
 create table icash_webinar_visitors(id uuid primary key,funding_guest_hash text,account_id uuid);
 create table icash_webinar_sessions(id uuid primary key,visitor_id uuid,webinar_id uuid,revision integer default 1,is_preview boolean default false,created_at timestamptz,config jsonb,watched_seconds numeric default 0,completed_at timestamptz);
 create table icash_webinar_events(visitor_id uuid,session_id uuid,kind text,created_at timestamptz);
 create table icash_funding_orders(mode text,state text,stripe_payment_id text,price_cents bigint,tax_cents bigint,paid_at timestamptz,guest_hash text,account_id uuid);
 create table icash_memberships(id uuid primary key,mode text,guest_hash text,account_id uuid);
 create table icash_membership_invoices(membership_id uuid,stripe_payment_id text,amount_cents bigint,recorded_at timestamptz);
 create table icash_billing_reviews(payment_id text);
 create view icash_regular_webinars as select * from icash_webinars where nullif(config->>'legacyCampaignId','') is null;
 create view icash_regular_webinar_sessions as select * from icash_webinar_sessions where nullif(config->>'legacyCampaignId','') is null;
 `);
 const attributed=read('supabase/migrations/20261004194452_webinar_variants_and_value_optimization.sql').match(/create function public\.icash_webinar_attributed_purchases\(\)[\s\S]*?\$\$;/)[0];
 const daily=read('supabase/migrations/20261006183014_webinar_public_links_and_session_scope.sql').match(/create or replace function public\.icash_webinar_daily_report\([\s\S]*?end \$\$;/)[0];
 const funnel=read('config/conversion-funnels.sql').match(/create or replace function public\.icash_webinar_report_with_funnel\([\s\S]*?end \$\$;/)[0];
 await pg.exec(clock(attributed));await pg.exec(clock(regular(daily)));await pg.exec(clock(regular(funnel)));
 for(let w=1;w<=4;w++)await query('insert into icash_webinars values($1,$2,$3)',[id(w),JSON.stringify(w===4?{legacyCampaignId:'separate-campaign'}:{nightVersion:{durationSeconds:900}}),`2026-10-${20+w}T00:00:00Z`]);
 for(let n=1;n<=140;n++){
  const v=id(1000+n),session=id(2000+n),w=id(1+n%4),at=new Date(Date.parse('2026-10-15T00:00:00Z')+n%35*86400000+n%24*3600000),paymentAt=new Date(+at+3600000);
  const config=n%29===0?[]:{durationSeconds:n%17===0?0:1800,recordingVersion:n%3===0?'night':undefined,audience:n%5===0?'night':'day',legacyCampaignId:n%13===0?'separate-campaign':n%7===0?'':undefined,chat:Array.from({length:20},(_,i)=>({at:i,text:'Synthetic saved chat'}))};
  await query('insert into icash_webinar_visitors values($1,$2,null)',[v,'guest-'+n]);
  await query('insert into icash_webinar_sessions(id,visitor_id,webinar_id,is_preview,created_at,config,watched_seconds,completed_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[session,v,w,n%11===0,at.toISOString(),JSON.stringify(config),n*31,n%5===0?paymentAt.toISOString():null]);
  for(const [i,kind] of ['started','pitch_shown','add_to_cart','checkout_started','contact_saved'].entries())if(i===0||n%(i+2)!==0)await query('insert into icash_webinar_events values($1,$2,$3,$4)',[v,session,kind,new Date(+at+i*60000).toISOString()]);
  if(n%3===0){
   await query("insert into icash_funding_orders values($1,'paid',$2,5000,100,$3,$4,null)",[n%12===0?'test':'live','pi_fixture_'+n,paymentAt.toISOString(),'guest-'+n]);
   if(n%15===0)await query('insert into icash_billing_reviews values($1)',['pi_fixture_'+n]);
   if(n%9===0){await query("insert into icash_memberships values($1,'live',$2,null)",[v,'guest-'+n]);await query('insert into icash_membership_invoices values($1,$2,5100,$3)',[v,'pi_fixture_'+n,paymentAt.toISOString()]);}
  }
  // A later session and earlier offer on the same person test cohort and session deduplication.
  if(n%7===0){const next=id(3000+n);await query('insert into icash_webinar_sessions select $1,visitor_id,webinar_id,2,is_preview,created_at+interval \'2 hours\',config,300,null from icash_webinar_sessions where id=$2',[next,session]);await query("insert into icash_webinar_events values($1,$2,'started',$3),($1,$2,'checkout_started',$4)",[v,next,new Date(+at+7200000).toISOString(),new Date(+at+10800000).toISOString()]);}
 }
 const cases=[];
 for(const period of ['today','yesterday','7d','30d'])for(const timezone of ['America/Chicago','UTC','America/Los_Angeles'])cases.push({period,timezone,before:await report(period,timezone)});
 const sql=read('config/webinar-report-ranges.sql');
 assert.equal(sql,read('supabase/migrations/20261116184732_webinar_report_ranges.sql'));
 await pg.exec(clock(sql));
 for(const {period,timezone,before} of cases){
  const after=await report(period,timezone);assert.deepEqual(after,before,`${period} / ${timezone}: every card, recording, day, watch metric and funnel must match`);
  assert(validWebinarReport(after,period,timezone));assert.equal(after.days.length,period==='30d'?30:period==='7d'?7:1);
 }
 // Pooled API connections can choose a generic plan after repeated small windows.
 // Keep the SQL/data contract identical while the function plans its own window.
 const planning=read('config/webinar-report-planning.sql');
 assert.equal(planning,read('supabase/migrations/20261116204300_webinar_report_planning.sql'));
 assert(planning.includes('d0cf08efe4c4536d11c0fa8921cf4c81'));
 const original=(await query("select md5(pg_get_functiondef(oid)) hash,prosrc,proacl from pg_proc where oid='icash_webinar_report_with_funnel(text,text)'::regprocedure")).rows[0];
 // The fixture substitutes a fixed clock; only its expected source digest differs.
 const fixturePlanning=planning.replace('d0cf08efe4c4536d11c0fa8921cf4c81',original.hash);
 await pg.exec("alter function icash_webinar_report_with_funnel(text,text) set search_path to public");
 await assert.rejects(pg.exec(fixturePlanning),/Webinar report source changed/);
 await pg.exec("alter function icash_webinar_report_with_funnel(text,text) set search_path to ''");
 await pg.exec(fixturePlanning);
 const planned=(await query("select prosrc,proacl,proconfig from pg_proc where oid='icash_webinar_report_with_funnel(text,text)'::regprocedure")).rows[0];
 assert.equal(planned.prosrc,original.prosrc);assert.deepEqual(planned.proacl,original.proacl);
 assert(planned.proconfig.includes('plan_cache_mode=force_custom_plan'));
 const deadline=read('config/webinar-report-deadline.sql');
 assert.equal(deadline,read('supabase/migrations/20261116205000_webinar_report_deadline.sql'));
 assert(deadline.includes('65639530a3c096a43019c05a770ed5d7'));
 const plannedHash=(await query("select md5(pg_get_functiondef('icash_webinar_report_with_funnel(text,text)'::regprocedure)) hash")).rows[0].hash;
 const fixtureDeadline=deadline.replace('65639530a3c096a43019c05a770ed5d7',plannedHash);
 await pg.exec(fixtureDeadline);
 const bounded=(await query("select prosrc,proacl,proconfig from pg_proc where oid='icash_webinar_report_with_funnel(text,text)'::regprocedure")).rows[0];
 assert.equal(bounded.prosrc,original.prosrc);assert.deepEqual(bounded.proacl,original.proacl);
 assert(bounded.proconfig.includes('statement_timeout=12s'));
 assert(bounded.proconfig.includes('plan_cache_mode=force_custom_plan'));
 await assert.rejects(pg.exec(fixtureDeadline),/Webinar report source changed/);
 await pg.exec("set statement_timeout='4s'");
 await query('prepare repeated_report(text,text) as select icash_webinar_report_with_funnel($1,$2) r');
 for(const mode of ['force_generic_plan','force_custom_plan','auto']){
  await pg.exec('set plan_cache_mode='+mode);
  for(let n=0;n<6;n++)await query("execute repeated_report('today','UTC')");
  for(const {period,timezone,before} of cases){
   const after=(await query(`execute repeated_report('${period}','${timezone}')`)).rows[0].r;
   assert.deepEqual(after,before,`${mode}: repeated short reports followed by ${period} / ${timezone}`);
  }
  assert.equal((await query('show plan_cache_mode')).rows[0].plan_cache_mode,mode,'function setting must remain scoped');
  assert.equal((await query('show statement_timeout')).rows[0].statement_timeout,'4s','report deadline must not change its caller');
 }
 await pg.exec('deallocate repeated_report;set plan_cache_mode=auto;set statement_timeout=0');
 await assert.rejects(pg.exec(fixturePlanning),/Webinar report source changed/);
 for(const args of [['bad','UTC'],[null,'UTC'],['today','Bad/Zone'],['today',null]])await assert.rejects(report(...args),/Invalid report/);
 for(const role of ['anon','authenticated','service_role'])assert.equal((await query("select has_function_privilege($1,'icash_webinar_report_with_funnel(text,text)','execute') allowed",[role])).rows[0].allowed,role==='service_role');
 const fn=(await query("select prosecdef,provolatile,proconfig from pg_proc where oid='icash_webinar_report_with_funnel(text,text)'::regprocedure")).rows[0];
 assert.equal(fn.prosecdef,false);assert.equal(fn.provolatile,'s');assert(fn.proconfig.includes('search_path=""'));
 await pg.exec('truncate icash_webinar_events,icash_funding_orders,icash_membership_invoices');
 for(const period of ['7d','30d']){const empty=await report(period,'America/Chicago');assert(validWebinarReport(empty,period,'America/Chicago'));assert.equal(empty.summary.viewers,0);assert.equal(empty.summary.revenueCents,0);assert(empty.conversionFunnel.summary.every(s=>s.count===0));}
 console.log('PASS webinar report ranges: exact old/new equality for 12 period/timezone combinations, repeated prepared reports under all plan modes, source-drift rejection, scoped planning, recording scopes, repeated viewers, legacy/preview/test/review exclusions, payment deduplication, watch metrics, empty periods and service-only access.');
}finally{await pg.close();}
