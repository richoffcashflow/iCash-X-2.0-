// Current production contact preparation/routing plus real repository lookup and
// consent. All fixtures are offline; account/service eligibility outside this
// policy remains explicit in the base fixture, never a provider success claim.
import {readFileSync} from 'node:fs';
import {setupOwnerDemoFinalAdmissionFixture} from './owner-demo-final-admission-fixture.mjs';
import {setupOwnerDemoRunFixture} from './owner-demo-run-fixture.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const between=(s,start,end)=>{const a=s.indexOf(start),b=s.indexOf(end,a);if(a<0||b<0)throw new Error('Fixture source boundary changed: '+start);return s.slice(a,b);};
export async function setupOwnerDemoRestartFixture(options){
 const {pg,account,sender}=options;
 await setupOwnerDemoRunFixture({...options,distinct:false});
 // Complete the real lookup prerequisite without loading unrelated paid paths.
 const tables=read('supabase/migrations/20261004170451_seller_intake_and_budgeted_lead_assignment.sql');
 for(const name of ['icash_seller_controls','icash_seller_events']){
  const start=tables.indexOf('create table public.'+name+' (');if(start<0)throw new Error('Missing '+name);
  await pg.exec(tables.slice(start,tables.indexOf(';',start)+1));
 }
 await pg.exec("insert into icash_seller_controls(id,enabled,data_rights_until,review_ref) values(1,true,now()+interval '1 day','Offline fixture review');");
 const lookup=read('config/seller-funnel-milestones.sql');
 await pg.exec(between(lookup,'CREATE OR REPLACE FUNCTION public.icash_finish_seller_lookup','-- Backfill genuine recent submissions'));
 await pg.exec(read('config/demo-intake-resubmission.sql'));
 await pg.exec(between(read('supabase/migrations/20261018150000_meta_contact_first_intake.sql'),'alter function public.icash_finish_seller_lookup(uuid,uuid,jsonb) rename','create function public.icash_meta_response_report'));
 const contacts=read('config/seller-intake-contacts.sql');
 await pg.exec(between(contacts,'create function public.icash_seller_voice_permission_current','create function public.icash_seller_sms_permission_current').replace('create function','create or replace function'));
 // The exact production role-conflict predicate, rather than a boolean stub.
 await pg.exec(`create table icash_webinar_text_assignments(sender text,recipient text);
 create table icash_customer_update_deliveries(sender text,recipient text,channel text,authorized_at timestamptz);
 create table icash_webinar_outbox(channel text,recipient text,payload jsonb,first_attempt_at timestamptz);
 create table icash_business_voice_numbers(phone text primary key,provider_account_sid text,outbound_enabled boolean,forwarding_ready boolean,caller_id_sid text);
 `);
 await pg.exec(between(read('supabase/migrations/20261008174620_customer_lifecycle_and_text_roles.sql'),'create function public.icash_text_role_conflict','-- Never assign a lead/customer'));
 // Captured from the actual balanced→verified→November→additional→PR654 chain.
 // The export is deterministic and guarded again by the ranking component.
 await pg.exec('set check_function_bodies=off;');
 for(const row of JSON.parse(read('tests/fixtures/owner-demo-routing-predecessors.json')))await pg.exec(row.definition);
 await pg.exec('set check_function_bodies=on;');
 await pg.query("insert into icash_business_voice_numbers values($1,'AC'||repeat('a',32),true,true,'PN'||repeat('b',32))",[sender]);
 await pg.query("insert into icash_voice_configs(account_id,enabled,reviewed_until) values($1,true,now()+interval '1 day')",[account]);
 const requestLimit=read('supabase/migrations/20260928031246_icash_verified_funding_and_accounts.sql');
 await pg.exec(between(requestLimit,'create table public.icash_request_limits','create function public.icash_settle_funding'));
 await setupOwnerDemoFinalAdmissionFixture(pg);
}
