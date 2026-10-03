// Isolated PostgreSQL only: no credentials, external APIs or production state.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const pg=await PGlite.create();const account='11111111-1111-4111-8111-111111111111';const other='22222222-2222-4222-8222-222222222222';
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.icash_accounts(id uuid primary key);
 create table public.icash_operation_spend(operation_key text primary key,account_id uuid,state text);
 create table public.icash_live_conversations(operation_key text,account_id uuid,state text,conversation_id text,agent_id text,contact_key text);
 insert into public.icash_accounts values('${account}'),('${other}');
 insert into public.icash_operation_spend values('voice:fixture','${account}','dispatched');
 insert into public.icash_live_conversations values('voice:fixture','${account}','complete','conv_fixture','agent_fixture','contact_fixture');`);
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261002220800_outbound_price_snapshots.sql',import.meta.url),'utf8'));
 await pg.exec('set role service_role');
 const snapshot={conversationId:'conv_fixture',agentId:'agent_fixture',destinationHash:'contact_fixture',microsPerMinute:94500};
 const record=(a,s)=>pg.query('select public.icash_record_outbound_price_snapshot($1,$2,$3)', ['voice:fixture',a,s]);
 await assert.rejects(record(other,snapshot),/Unbound outbound snapshot/);
 await assert.rejects(record(account,{...snapshot,agentId:'other'}),/Unbound outbound snapshot/);
 await record(account,snapshot);await record(account,{...snapshot,microsPerMinute:1});
 assert.equal((await pg.query('select snapshot from public.icash_outbound_price_snapshots')).rows[0].snapshot.microsPerMinute,94500);
 for(const sql of ["update public.icash_outbound_price_snapshots set snapshot='{}'",'delete from public.icash_outbound_price_snapshots','truncate public.icash_outbound_price_snapshots',`insert into public.icash_outbound_price_snapshots values('other','${account}','{}',now())`])await assert.rejects(pg.exec(sql),/permission denied/);
 await pg.exec('reset role;set role authenticated');await assert.rejects(record(account,snapshot),/permission denied/);await assert.rejects(pg.query('select * from public.icash_outbound_price_snapshots'),/permission denied/);
 console.log('PASS: isolated PostgreSQL migration, tenant/conversation binding, first-writer immutable snapshot, service write restrictions, authenticated denial');
}finally{await pg.close();}
