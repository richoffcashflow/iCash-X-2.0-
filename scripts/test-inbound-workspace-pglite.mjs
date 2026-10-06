import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table icash_accounts(id uuid primary key,owner_user_id uuid unique);
 create table icash_screening_jobs(id uuid primary key,state text constraint icash_screening_jobs_state_check check(state in ('queued','running','complete','failed')));
 create table icash_acquisition_policy(id int primary key,mode text,updated_at timestamptz);
 insert into icash_acquisition_policy values(1,'hybrid',now());
 create table icash_discovery_configs(enabled bool,auto_enabled bool,revision uuid);
 insert into icash_discovery_configs values(true,true,gen_random_uuid());
 create table icash_automation_tickets(kind text,state text,outcome text);
 insert into icash_automation_tickets values('discovery','issued',null),('voice_dispatch','issued',null);`);
 await pg.exec(read('supabase/migrations/20260928153922_customer_bot_identity.sql'));
 await pg.exec(read('config/inbound-workspace.sql'));
 const account='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002';
 await pg.query('insert into icash_accounts values($1,$2)',[account,user]);
 async function save(first,last,company,who=user){return (await pg.query('select icash_save_customer_identity($1,$2,$3,$4,$5,$6) identity',[who,first,last,company,'voiceA','Sarah'])).rows[0].identity;}
 assert.equal((await save('','','Oak Homes')).principal,'Oak Homes');
 assert.equal((await save('Jordan','Smith','')).principal,'Jordan Smith');
 await assert.rejects(save('','',''));
 await assert.rejects(save('Jordan','',''));
 await assert.rejects(save('','Smith',''));
 await assert.rejects(save('','','Oak Homes','00000000-0000-4000-8000-000000000099'));
 await assert.rejects(save('','','<bad>'));
 assert.equal((await save('','','Oak Homes')).voice_id,'voiceA');
 const q=async s=>(await pg.query(s)).rows;
 assert.equal((await q('select mode from icash_acquisition_policy'))[0].mode,'inbound');
 assert.equal((await q('select count(*)::int n from icash_discovery_configs where enabled or auto_enabled'))[0].n,0);
 assert.equal((await q("select state from icash_automation_tickets where kind='discovery'"))[0].state,'held');
 assert.equal((await q("select state from icash_automation_tickets where kind='voice_dispatch'"))[0].state,'issued');
 await pg.query("insert into icash_screening_jobs values($1,'archived')",[account]);
 assert.equal((await q("select count(*)::int n from icash_screening_jobs where state='complete'"))[0].n,0);
 for(const role of ['anon','authenticated'])assert.equal((await pg.query("select has_function_privilege($1,'icash_save_customer_identity(uuid,text,text,text,text,text)','execute') ok",[role])).rows[0].ok,false);
 console.log('PASS company/full-name validation, tenant ownership, preserved voice/ACL, archived exclusion and inbound-only discovery holds.');
}finally{await pg.close();}
