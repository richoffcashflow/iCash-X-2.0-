import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {trainOutcomeRanker} from '../lib/outcome-ranker.ts';
const db=new PGlite(),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const q=(sql,args=[])=>db.query(sql,args),val=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const patch=read('config/ranker-evidence-and-temporal-sampling.sql');
assert.equal(patch,read('supabase/migrations/20261104052150_ranker_evidence_and_temporal_sampling.sql'));
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(read('tests/fixtures/shared-learning-schema.sql'));
 await db.exec(`alter table icash_screening_jobs add primary key(id);
 create function icash_opportunity_score(uuid,jsonb,text) returns numeric language sql as $$select 0.5::numeric$$;
 create function icash_refresh_learning_account(uuid) returns void language sql as $$select$$;
 create function icash_seller_sms_interest_at(uuid,uuid,timestamptz,timestamptz) returns timestamptz language sql as $$select null::timestamptz$$;
 create function icash_platform_learning_report(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;`);
 await db.exec(read('supabase/migrations/20261021185044_platform_shared_learning_schema.sql'));
 await db.exec(read('supabase/migrations/20261027035912_outcome_ranker.sql'));
 await db.exec(read('config/seller-response-policy.sql'));
 await db.exec(read('config/seller-optout-base-verbs.sql'));
 await db.exec(read('supabase/migrations/20261023175907_seller_call_contact_evidence.sql').match(/create or replace function public\.icash_call_has_seller_response[\s\S]*?\$\$;/)[0]);
 await db.exec(read('config/seller-interest-evidence.sql').split('do $patch$')[0]+'commit;');
 await db.exec(read('config/seller-interest-reviewed-question.sql'));
 await db.exec(patch);
 assert.equal(await val("select has_function_privilege('authenticated','icash_claim_ranker_training()','execute')"),false,'Forward replacement retains private ACLs');
 await q('insert into icash_accounts(id) values($1),($2)',[id(1),id(2)]);
 // Every synthetic message has the same queue age; only original dispatch evidence varies.
 for(let n=10;n<21;n++){
  await q(`insert into icash_screening_jobs(id,account_id,state) values($1,$2,'pending');
   `,[id(n),id(1)]);
  await q(`insert into icash_ranker_private.samples(screening_id,account_id,property_key,features,observed_at,captured_at,baseline,cohort)
   values($1,$2,$3,array_fill(0::double precision,array[12]),now()-interval '120 days',now()-interval '110 days',0.5,'collecting')`,[id(n),id(1),`clock-${n}`]);
  await q(`insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,'{}');`,[id(n+100),id(1),id(n)]);
  await q(`insert into icash_text_threads(id,account_id,deal_id,party) values($1,$2,$3,'seller')`,[id(n+200),id(1),id(n+100)]);
  await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,provider_id,created_at,updated_at,last_delivery_at)
   values($1,$2,$3,'outgoing','accepted',$4,now()-interval '90 days',now(),now()-interval '1 day')`,[id(n+300),id(1),id(n+200),`provider-${n}`]);
 }
 const operation=async(n,age,account=id(1))=>q(`insert into icash_operation_spend(operation_key,account_id,state,dispatched_at)
  values($1,$2,'settled',now()-($3::text||' days')::interval)`,[`text:${id(n+300)}`,account,age]);
 await q('update icash_ranker_private.samples set baseline=null where screening_id=$1',[id(10)]);
 await operation(10,2);await operation(11,10); // Queue time would prematurely mature interest/contract/closing.
 await operation(13,4,id(2)); // Exact key, wrong account.
 await operation(14,4);await q("update icash_text_messages set state='ready' where id=$1",[id(314)]);
 await operation(15,4);await q('update icash_text_messages set provider_id=null where id=$1',[id(315)]);
 await operation(16,-1);await operation(17,100); // Future and impossible before-queue dispatch.
 await operation(18,4);await q("update icash_text_messages set state='delivered' where id=$1",[id(318)]);
 await operation(19,4);
 await q(`insert into icash_operation_spend(operation_key,account_id,state,dispatched_at) values('voice:first',$1,'settled',now()-interval '7 days')`,[id(1)]);
 await q(`insert into icash_live_conversations(id,account_id,screening_id,party,conversation_id,operation_key,state,completed_at,result)
  values($1,$2,$3,'seller','voice-provider','voice:first','complete',now()-interval '7 days','{"interested":true,"transcript":[{"role":"agent","message":"Would you be interested in selling your property?"},{"role":"user","message":"Yes"}]}')`,[id(400),id(1),id(19)]);
 await operation(20,4);
 await q(`insert into icash_live_conversations(id,account_id,screening_id,party,conversation_id,operation_key,state,completed_at,result)
  values($1,$2,$3,'seller','ownership-provider',$4,'complete',now()-interval '4 days','{"interested":true,"transcript":[{"role":"agent","message":"Are you the owner?"},{"role":"user","message":"Yes"}]}')`,[id(401),id(1),id(20),`text:${id(320)}`]);
 const features=await val(`select jsonb_agg(jsonb_build_object('id',screening_id,'features',features,'observed',observed_at,'captured',captured_at,'cohort',cohort,'model',model_id,'prediction',prediction) order by screening_id) from icash_ranker_private.samples`);
 const original=await val(`select jsonb_build_object('messages',(select jsonb_agg(to_jsonb(m) order by id) from icash_text_messages m),
  'operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o))`);
 await val('select icash_refresh_ranker_samples($1)',[id(1)]);
 assert.equal(await val(`select exposed_at=o.dispatched_at and interest is null and contract is null and closing is null
  from icash_ranker_private.samples s join icash_operation_spend o on o.operation_key=$2 where s.screening_id=$1`,[id(10),`text:${id(310)}`]),true,'A delayed send begins its window at dispatch, never queue or receipt update');
 assert.equal(await val('select baseline from icash_ranker_private.samples where screening_id=$1',[id(10)]),null,'Corrected exposure never reconstructs an unknown prospective baseline');
 assert.deepEqual((await q('select interest,contract,closing from icash_ranker_private.samples where screening_id=$1',[id(11)])).rows[0],{interest:0,contract:null,closing:null});
 for(const n of [12,13,14,15,16,17])assert.equal(await val('select exposed_at is null and interest is null and contract is null and closing is null from icash_ranker_private.samples where screening_id=$1',[id(n)]),true,`Unproved or impossible dispatch ${n} stays unknown`);
 assert.equal(await val('select interest from icash_ranker_private.samples where screening_id=$1',[id(18)]),0,'Verified exposure with a complete window may be a measured negative');
 assert.equal(await val(`select exposed_at=o.dispatched_at and interest=1 from icash_ranker_private.samples s join icash_operation_spend o on o.operation_key='voice:first' where s.screening_id=$1`,[id(19)]),true,'Earlier original voice dispatch retains precedence');
 assert.equal(await val('select interest from icash_ranker_private.samples where screening_id=$1',[id(20)]),0,'Provider interest and ownership confirmation cannot become a selling-interest label');
 assert.deepEqual(await val(`select jsonb_build_object('messages',(select jsonb_agg(to_jsonb(m) order by id) from icash_text_messages m),
  'operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o))`),original,'Learning never edits original message or operation receipts');

 assert.deepEqual(await val(`select jsonb_agg(jsonb_build_object('id',screening_id,'features',features,'observed',observed_at,'captured',captured_at,'cohort',cohort,'model',model_id,'prediction',prediction) order by screening_id) from icash_ranker_private.samples`),features,'Derived label correction preserves original captured feature/model assignments');

 // High recent volume used to evict every contract/closing cohort. Each account
 // now contributes to all four ages before either fixed cap is applied.
 await db.exec(`truncate icash_ranker_private.samples;
 insert into icash_accounts(id) select md5('account-'||a)::uuid from generate_series(1,40) a;
 insert into icash_screening_jobs(id,account_id,state)
 select md5('sample-'||a||'-'||b||'-'||n)::uuid,md5('account-'||a)::uuid,'pending'
 from generate_series(1,40) a cross join generate_series(0,3) b cross join generate_series(1,400) n where b=3 or n<=60;
 insert into icash_ranker_private.samples(screening_id,account_id,property_key,features,observed_at,captured_at,baseline,cohort,exposed_at,interest,contract,closing,refreshed_at)
 select md5('sample-'||a||'-'||b||'-'||n)::uuid,md5('account-'||a)::uuid,'sample-'||a||'-'||b||'-'||n,
 array[(n%2)::double precision]||array_fill(0::double precision,array[11]),now()-interval '230 days',now()-interval '229 days',0.5,'collecting',
 now()-case b when 0 then interval '200 days' when 1 then interval '70 days' when 2 then interval '35 days' else interval '5 days' end-n*interval '1 minute',
 n%2,case when b<=2 then n%2 end,case when b<=1 then n%2 end,now()
 from generate_series(1,40) a cross join generate_series(0,3) b cross join generate_series(1,400) n where b=3 or n<=60;
 update icash_ranker_private.settings set enabled=true;`);
 const claim=await val('select icash_claim_ranker_training()');
 assert.equal(claim.samples.length,5000);
 const bands=[0,0,0,0],accounts=new Map();
 for(const row of claim.samples){
  const age=(Date.parse(claim.asOf)-Date.parse(row.exposedAt))/86400000;
  bands[age>=120?0:age>=60?1:age>=30?2:3]++;
  accounts.set(row.account,(accounts.get(row.account)??0)+1);
 }
 assert.deepEqual(bands,[1250,1250,1250,1250],'Old and recent cohorts retain equal bounded representation under high volume');
 assert(Math.max(...accounts.values())<=200,'Per-account contribution cap is unchanged');
 assert.equal(await val('select icash_claim_ranker_training()'),null,'A concurrent request cannot acquire the same live lease');
 const trained=trainOutcomeRanker(claim.samples,claim.asOf);
 assert.equal(trained.model?.objective,'closing','The original unchanged trainer can still build a disjoint 60-day closing comparison despite heavy recent traffic');
 assert.equal(trained.status,'qualified');
 assert(trained.metrics.train>=200&&trained.metrics.validation>=100);
 await q('update icash_ranker_private.settings set lease_until=null');
 const repeated=await val('select icash_claim_ranker_training()');
 assert.deepEqual(repeated.samples.map(r=>r.property),claim.samples.map(r=>r.property),'Sampling is deterministic and does not oversample successful labels');
 // Missing age bands yield their unused places to remaining evidence, never padding.
 await q("delete from icash_ranker_private.samples where exposed_at<now()-interval '30 days'");
 await q('update icash_ranker_private.settings set lease_until=null');
 assert.equal((await val('select icash_claim_ranker_training()')).samples.length,5000,'Unused age capacity is reused while keeping the global cap');
 await q("update icash_ranker_private.samples set refreshed_at=now()-interval '3 hours'");
 await q('update icash_ranker_private.settings set lease_until=null');
 assert.deepEqual((await val('select icash_claim_ranker_training()')).samples,[],'Stale labels never enter the training export');
 console.log('Ranker evidence: original dispatch clocks, unknown outcomes, immutable receipts, temporal cohorts, fixed account/export caps and unchanged closing validation passed.');
}finally{await db.close();}
