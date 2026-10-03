/** Isolated native PostgreSQL concurrency proof. No provider or production connection. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createJourneyDb} from '../tests/helpers/simulated-journey-db.mjs';
import {databaseAdapter} from '../tests/helpers/simulated-journey-services.mjs';
if(process.env.ZIP_TEST_LOCAL!=='1')throw Error('Isolated local opt-in required');
const require=createRequire(import.meta.url),{Client,types}=require(process.env.PG_MODULE||'/tmp/icash-pg-review/root/usr/share/nodejs/pg');types.setTypeParser(20,Number);
const connection={host:'127.0.0.1',port:Number(process.env.ZIP_TEST_PORT||55453),user:'agent',database:'postgres'};
const main=new Client(connection),a=new Client(connection),b=new Client(connection),c=new Client(connection);
await Promise.all([main.connect(),a.connect(),b.connect(),c.connect()]);
const native={query:(...args)=>main.query(...args),exec:sql=>main.query(sql),close:async()=>Promise.all([main.end(),a.end(),b.end(),c.end()])};
const {pg}=await createJourneyDb(null,native);const {rpc,q}=databaseAdapter(pg);
const one=async(sql,args=[])=>{const {rows}=await q(sql,args);assert.equal(rows.length,1);return rows[0];};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const blocked=async(client)=>{for(let i=0;i<80;i++){if((await main.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'",[client.processID])).rows.length)return;await sleep(25);}throw Error('Expected real session lock wait');};
try{
 console.log((await one('select version()')).version);
 const user=randomUUID(),guest='b'.repeat(64);await q("insert into auth.users(id,email,email_confirmed_at) values($1,'nativezip@example.invalid',now())",[user]);
 const setup=await rpc('icash_init_bot_setup',{p_guest:guest});await rpc('icash_save_bot_setup',{p_setup:setup.id,p_revision:0,p_profile:{displayName:'Fixture',marketMode:'city',market:'94103'},p_stage:4});
 const order=(await one("insert into icash_funding_orders(mode,guest_hash,pack_code,price_cents,credit_cents) values('live',$1,'work',300,300) returning id",[guest])).id;
 await rpc('icash_settle_funding',{p_order:order,p_mode:'live',p_session:'cs_live_NATIVE_ZIP',p_payment:'pi_NATIVE_ZIP',p_amount:300,p_email:'nativezip@example.invalid',p_phone:null});
 const account=await rpc('icash_claim_funding',{p_user:user,p_mode:'live'});
 const geo=await rpc('icash_claim_requested_property_zip',{p_user:user,p_account:account});assert.equal(geo.status,'lookup_required');
 assert.equal((await rpc('icash_save_requested_property_zip',{p_user:user,p_account:account,p_zip:'94103',p_token:geo.token,p_location:{location_id:'loc_zip_code_94103',type:'zip_code',code:'94103',name:'Fixture San Francisco',state:'CA',property_count:15000}})).status,'known');
 await rpc('icash_provision_funded_account',{p_account:account});
 await q('update icash_operating_budget set enabled=true,require_company_reserve=false');await q('update icash_accounts set daily_limit_cents=300 where id=$1',[account]);await q('insert into icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,300)',[account]);await rpc('icash_set_work_control',{p_user:user,p_account:account,p_action:'resume'});
 const config=await one('select *,data_rights_until::text as exact_rights from icash_discovery_configs where account_id=$1',[account]);
 const params=[account,config.zip,config.revision,config.next_page,config.per_page,config.rate_id,config.property_credit_micros,config.exact_rights,1,'city','94103'];
 const claimSql='select icash_reserve_and_claim_property_discovery($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) claimed';
 await b.query('set role service_role');
 const assertNoSpend=async()=>{assert.equal((await one('select count(*)::int n from icash_operation_spend where account_id=$1',[account])).n,0);assert.equal((await one('select reserved_cents::int n from icash_wallets where account_id=$1',[account])).n,0);};
 const race=async({lock,change,undo,label})=>{
  console.log('Checking',label);
  await a.query('begin');await a.query(lock,[account]);
  const result=b.query(claimSql,params);await blocked(b);await a.query(change,[account]);await a.query('commit');
  assert.equal((await result).rows[0].claimed,false,label);await assertNoSpend();await main.query(undo,[account]);
 };
 await race({label:'setup request changes while atomic claim waits',lock:'select * from icash_bot_setups where account_id=$1 for update',change:"update icash_bot_setups set profile=profile||'{\"market\":\"35206\"}'::jsonb where account_id=$1",undo:"update icash_bot_setups set profile=profile||'{\"market\":\"94103\"}'::jsonb where account_id=$1"});
 for(const [column,change,undo] of [
  ['revision','gen_random_uuid()',`'${config.revision}'::uuid`],['next_page','next_page+1',String(config.next_page)],
  ['rate_id',"(select id from icash_operation_rates where operation='owner_enrichment' limit 1)",`'${config.rate_id}'::uuid`],
 ])await race({label:'config '+column+' changes while claim waits',lock:'select * from icash_discovery_configs where account_id=$1 for update',change:`update icash_discovery_configs set ${column}=${change} where account_id=$1`,undo:`update icash_discovery_configs set ${column}=${undo} where account_id=$1`});
 // The transaction starts before this cache entry expires. clock_timestamp must
 // reject it after the lock wait; now() alone would incorrectly admit the work.
 console.log('Checking cache expiry across lock wait');
 await a.query('begin');await a.query("update icash_property_zip_geographies set expires_at=clock_timestamp()+interval '150 milliseconds' where zip='94103'");
 const expiry=b.query(claimSql,params);await blocked(b);await sleep(200);await a.query('commit');assert.equal((await expiry).rows[0].claimed,false);await assertNoSpend();await main.query("update icash_property_zip_geographies set expires_at=now()+interval '1 day' where zip='94103'");
 // Hold the DB transaction immediately inside the financial reserve INSERT.
 // Setup and geography updates must still wait until that same claim commits.
 console.log('Checking scope lock across reserve and claim');
 await main.query("create function fixture_hold_property_reserve() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(9912345);return new;end$$;create trigger fixture_hold_property_reserve before insert on icash_operation_spend for each row execute function fixture_hold_property_reserve()");
 // Expiry after initial validation but while the reserve INSERT is blocked
 // must roll back the partially created reservation and its wallet hold.
 await main.query("update icash_property_zip_geographies set expires_at=clock_timestamp()+interval '150 milliseconds' where zip='94103'");
 await a.query('begin');await a.query('select pg_advisory_xact_lock(9912345)');
 const reserveExpiry=b.query(claimSql,params).then(()=>({ok:true}),e=>({error:e.message}));await blocked(b);await sleep(200);await a.query('commit');
 assert.match((await reserveExpiry).error,/scope expired before claim/);await assertNoSpend();
 await main.query("update icash_property_zip_geographies set expires_at=now()+interval '1 day' where zip='94103'");
 await a.query('begin');await a.query('select pg_advisory_xact_lock(9912345)');await b.query('begin');
 const winner=b.query(claimSql,params);await blocked(b);console.log('Reserve insert blocked with scope locks held');
 const profileUpdate=c.query("update icash_bot_setups set profile=profile||'{\"market\":\"35206\"}'::jsonb where account_id=$1",[account]);await blocked(c);console.log('Concurrent profile update blocked before claim');
 await a.query('commit');assert.equal((await winner).rows[0].claimed,true);await blocked(c);
 assert.equal((await b.query("select state from icash_operation_spend where account_id=$1",[account])).rows[0].state,'dispatched');
 await b.query('commit');await profileUpdate;await main.query("update icash_bot_setups set profile=profile||'{\"market\":\"94103\"}'::jsonb where account_id=$1",[account]);
 assert.equal((await b.query(claimSql,params)).rows[0].claimed,false,'one-use claim cannot be replayed');
 assert.equal((await one('select count(*)::int n from icash_operation_spend where account_id=$1',[account])).n,1);
 assert.equal((await one('select reserved_cents::int n from icash_wallets where account_id=$1',[account])).n,84);
 console.log('NATIVE POSTGRES PASS: service-role exact scope claim; separate-session setup/revision/page/rate mutation races reject before funds; cache expires during real lock wait and rejects; expiry during reserve rolls back all funds; scope lock survives financial reserve and dispatch claim through commit; one reservation, no replay. No provider calls.');
}catch(e){console.error('NATIVE_ZIP_FAILED',e.message,e.where??'');process.exitCode=1;}finally{await Promise.allSettled([a.query('rollback'),b.query('rollback'),c.query('rollback')]);await pg.close();}
