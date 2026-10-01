// SIMULATION ONLY. Real PostgreSQL functions and synthetic plans; no provider/network calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createJourneyDb} from '../tests/helpers/simulated-journey-db.mjs';
const {pg}=await createJourneyDb(process.argv[2]);
const q=(sql,params=[])=>pg.query(sql,params);
try{
 await pg.exec(readFileSync(new URL('../config/daily-billing.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync(new URL('../config/durable-work-billing-stop.sql',import.meta.url),'utf8'));
 const user=randomUUID(),other=randomUUID(),account=randomUUID(),otherAccount=randomUUID();
 await q('insert into auth.users(id,email) values($1,$2),($3,$4)',[user,'stop@example.invalid',other,'other@example.invalid']);
 await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values($1,$2,'Fixture',false,10000),($3,$4,'Other',false,10000)",[account,user,otherAccount,other]);
 for(const [a,mode,state] of [[account,'live','active'],[account,'test','active'],[otherAccount,'live','active']])await q("insert into icash_daily_plans(account_id,mode,guest_hash,state,consent_version,consent_text) values($1,$2,$3,$4,'SIMULATION','SIMULATION explicit daily consent')",[a,mode,randomUUID(),state]);
 const run=(u=user,a=account,mode='live')=>q('select public.icash_pause_work_and_billing($1,$2,$3)',[u,a,mode]);
 await assert.rejects(run(other),/ownership/);await assert.rejects(run(user,account,'wrong'),/mode/);
 await q('begin');await run();await q('rollback');assert.equal((await q('select bot_paused from icash_accounts where id=$1',[account])).rows[0].bot_paused,false);assert.equal((await q("select state from icash_daily_plans where account_id=$1 and mode='live'",[account])).rows[0].state,'active');
 await run();await run();assert.equal((await q('select bot_paused from icash_accounts where id=$1',[account])).rows[0].bot_paused,true);
 const rows=(await q('select account_id,mode,state from icash_daily_plans')).rows;assert.equal(rows.find(x=>x.account_id===account&&x.mode==='live').state,'stop_requested');assert.equal(rows.find(x=>x.account_id===account&&x.mode==='test').state,'active');assert.equal(rows.find(x=>x.account_id===otherAccount).state,'active');
 await q("update icash_daily_plans set state='stopped' where account_id=$1 and mode='live'",[account]);await run();assert.equal((await q("select state from icash_daily_plans where account_id=$1 and mode='live'",[account])).rows[0].state,'stopped');
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,'public.icash_pause_work_and_billing(uuid,uuid,text)','execute') allowed",[role])).rows[0].allowed,false);
 console.log('SIMULATION durable Stop: atomic rollback, repeat, mode/account isolation, stopped preservation and service-only grants passed');
}finally{await pg.close();}
