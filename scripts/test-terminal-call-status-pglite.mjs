import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;create table icash_accounts(id uuid primary key);create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
 create table icash_call_recordings(id uuid primary key,account_id uuid,operation_key text,state text,call_sid text,start_claimed_at timestamptz,recording_sid text,conversation_id text,provider_account_sid text,from_phone text,to_phone text,created_at timestamptz,voice_job_id uuid);
 create table icash_voice_jobs(id uuid primary key,account_id uuid,operation_key text,conversation_id text,state text,provider_call_sid text,outcome text,updated_at timestamptz);
 create table icash_live_conversations(operation_key text);create table icash_wallets(account_id uuid,reserved_cents int);`);
 const sql=readFileSync('supabase/migrations/20261007020025_terminal_call_status_and_credit_readiness.sql','utf8').split('-- Match the actual')[0]+'commit;';await pg.exec(sql);await pg.exec(readFileSync('supabase/migrations/20261007020639_terminal_receipt_read_only_recording_access.sql','utf8'));
 const id='11111111-1111-4111-8111-111111111111',a='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',op='voice:'+job,ca='CA'+'b'.repeat(32),ac='AC'+'a'.repeat(32),now=new Date().toISOString();
 await pg.query('insert into icash_accounts values($1)',[a]);await pg.query('insert into icash_wallets values($1,977)',[a]);await pg.query("insert into icash_voice_jobs(id,account_id,operation_key,state) values($1,$2,$3,'dispatching')",[job,a,op]);
 await pg.query("insert into icash_call_recordings(id,account_id,operation_key,state,call_sid,provider_account_sid,from_phone,to_phone,created_at,voice_job_id) values($1,$2,$3,'failed',$4,$5,'+12025550101','+12025550102',$6,$7)",[id,a,op,ca,ac,now,job]);
 await pg.exec('grant select on icash_call_recordings,icash_live_conversations to service_role;grant select,update on icash_voice_jobs,icash_operating_budget to service_role;grant select on icash_wallets to service_role;alter role service_role bypassrls;');
 const receipt={sid:ca,account_sid:ac,from:'+12025550101',to:'+12025550102',direction:'outbound-api',date_created:now,status:'completed',duration:'12'};
 const note=async(r=receipt)=>(await pg.query('select icash_note_recorded_gate_terminal($1,$2,$3,$4) result',[id,a,op,r])).rows[0].result;
 for(const r of [{...receipt,to:'+12025550103'},{...receipt,status:'in-progress'},{...receipt,date_created:null},{...receipt,duration:null}])assert.equal(await note(r),false);
 await pg.query('update icash_call_recordings set start_claimed_at=now()');assert.equal(await note(),false);await pg.query('update icash_call_recordings set start_claimed_at=null');
 await pg.exec('set role service_role');assert.equal(await note(),true);assert.equal(await note(),true);
 assert.equal((await pg.query('select state from icash_voice_jobs')).rows[0].state,'held');assert.equal((await pg.query('select reserved_cents from icash_wallets')).rows[0].reserved_cents,977);assert.equal((await pg.query('select count(*)::int n from icash_recorded_gate_terminal_receipts')).rows[0].n,1);
 assert.equal((await pg.query("select has_table_privilege('authenticated','icash_recorded_gate_terminal_receipts','SELECT') allowed")).rows[0].allowed,false);
 assert.equal((await pg.query("select has_table_privilege('service_role','icash_recorded_gate_terminal_receipts','UPDATE') allowed")).rows[0].allowed,false);
 console.log('PASS terminal SQL: canonical identity, terminal state, no AI start, timestamp and duration, idempotent immutable receipt, held job, unchanged credit reservation and private access.');
}finally{await pg.close();}
