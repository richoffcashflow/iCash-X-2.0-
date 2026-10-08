import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export async function verifyIndependentMessaging(pg,q){
 const scalar=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
 const previous=await scalar('select config from icash_webinar_settings where id=1');
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261008184228_independent_messaging.sql',import.meta.url),'utf8'));
 const config=await scalar('select config from icash_messaging_settings where id=1');
 assert.equal(config.fromEmail,previous.fromEmail,'Existing sender is carried forward');
 const saved={...config,enabled:false,smsEnabled:false,fromEmail:'existing@example.test'};
 assert.equal(await scalar('select icash_messaging_save($1,true,1)',[saved]),2);
 assert.equal(await scalar('select icash_messaging_save($1,false,1)',[config]),null,'Stale admin tab cannot change either phase');
 assert.equal(await scalar('select enabled from icash_customer_update_settings where id=1'),true,'Campaign pause does not pause customers');
 const web=await scalar('select config from icash_webinar_settings where id=1');
 assert.deepEqual(web.routing,previous.routing);assert.deepEqual(web.meta,previous.meta);
 await q("update icash_webinar_settings set config=config||'{\"enabled\":true,\"fromEmail\":\"stale@example.test\"}'::jsonb");
 assert.equal(await scalar("select config->>'fromEmail' from icash_webinar_settings where id=1"),saved.fromEmail,'Old studio save preserves messaging settings');
 assert.equal(await scalar("select config->>'enabled' from icash_webinar_settings where id=1"),'false');
 const definition=await scalar("select pg_get_functiondef('icash_webinar_authorize_followup(uuid,jsonb)'::regprocedure)");
 assert(definition.includes('from public.icash_messaging_settings'));
 assert(!definition.includes('from public.icash_webinar_settings'));
 // A customer with no visitor/session still has independent reminders.
 await q("update icash_customer_update_preferences set next_scan_at=now()+interval '1 day'");
 const user=randomUUID(),account=randomUUID();
 await q("insert into auth.users values($1,'independent@example.test',now())",[user]);
 await q('insert into icash_accounts(id,owner_user_id) values($1,$2)',[account,user]);
 await scalar("select icash_customer_update_preferences_save($1,$2,true,false,null,'America/Chicago','bot-updates-2026-10-08.1')",[account,user]);
 assert.equal(await scalar('select source_webinar_visitor from icash_customer_update_preferences where account_id=$1',[account]),null);
 const due=await q('select icash_messaging_due_customers(50) as account');
 assert.deepEqual(due.rows.map(r=>r.account),[account]);
 assert.equal((await q('select icash_messaging_due_customers(50)')).rows.length,0,'Repeated scans do not duplicate the reservation');
 await q('update icash_customer_update_preferences set next_scan_at=now() where account_id=$1',[account]);
 assert.equal(await scalar('select icash_messaging_save($1,false,2)',[saved]),3);
 assert.equal((await q('select icash_messaging_due_customers(50)')).rows.length,0,'Customer pause applies to its own scanner');
 for(const role of ['anon','authenticated']){
  assert.equal(await scalar("select has_table_privilege($1,'icash_messaging_settings','select')",[role]),false);
  for(const signature of ['icash_messaging_save(jsonb,boolean,integer)','icash_messaging_due_customers(integer)','icash_messaging_customer_stats()'])assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 }
 assert.equal(await scalar("select relrowsecurity from pg_class where oid='icash_messaging_settings'::regclass"),true);
 console.log('Independent messaging DB: preserved sender, atomic revision guard, studio isolation, customer-only enrollment, leased scan, pause and private access passed.');
}
