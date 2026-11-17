import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
export const copyMigrationPath='supabase/migrations/20261116234038_title_executed_copy_requests.sql';
export async function installTitleCopyFixture(db){
 await db.exec(readFileSync('tests/fixtures/title-copy-schema.sql','utf8'));
 await db.exec(readFileSync('config/title-requests.sql','utf8'));
 await db.exec(readFileSync('config/title-inbound.sql','utf8'));
 await db.exec(readFileSync('config/title-tasks.sql','utf8'));
 await db.exec(`alter table public.icash_title_tasks alter column request_id drop not null;
  alter table public.icash_title_tasks drop constraint icash_title_tasks_kind_check;
  alter table public.icash_title_tasks add constraint icash_title_tasks_kind_check check(kind in ('follow_up','reply_review','deadline','document_update'));
  alter table public.icash_title_tasks add column payload jsonb not null default '{}';
  alter table public.icash_title_tasks add column email_state text not null default 'waiting';
  alter table public.icash_title_tasks add column email_provider_id text;
  alter table public.icash_title_tasks add column email_retry_at timestamptz not null default now();
  alter table public.icash_title_requests add column delivered_assignment_ids uuid[] not null default '{}';
  alter table public.icash_title_requests add column delivered_payout jsonb;`);
 await db.exec(readFileSync('tests/fixtures/title-copy-predecessors.sql','utf8'));
 await db.exec(`revoke all on function public.icash_claim_title_update(uuid,uuid,jsonb),public.icash_record_title_reply(uuid,text,uuid,text,text,text,boolean),public.icash_signing_action_allowed(uuid,uuid),public.icash_title_contact_matches(uuid,uuid,text) from public,anon,authenticated;
 grant execute on function public.icash_claim_title_update(uuid,uuid,jsonb),public.icash_record_title_reply(uuid,text,uuid,text,text,text,boolean),public.icash_signing_action_allowed(uuid,uuid),public.icash_title_contact_matches(uuid,uuid,text) to service_role;
 grant usage on schema public to service_role;grant all on all tables in schema public to service_role;`);
 await db.exec('begin;'+readFileSync('config/title-original-source.sql','utf8')+'commit;');
}
export async function titleCopyCase(db){
 const account=randomUUID(),deal=randomUUID(),purchase=randomUUID(),assignment=randomUUID(),rate=randomUUID(),request=randomUUID(),property='fixture-'+randomUUID();
 await db.query('insert into public.icash_accounts(id,owner_user_id) values($1,$2)',[account,randomUUID()]);
 await db.query('insert into public.icash_screening_jobs values($1,$2,$3)',[deal,account,{propertyId:property}]);
 await db.query("insert into public.icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$1,'under_contract',$3)",[deal,account,{address:'Fixture title property',titleEmail:'closer@example.invalid'}]);
 await db.query("insert into public.icash_signing_envelopes(id,account_id,deal_id,kind,state,provider_id) values($1,$3,$4,'purchase','completed','101'),($2,$3,$4,'assignment','completed','102')",[purchase,assignment,account,deal]);
 await db.query('update public.icash_signing_envelopes e set terms=d.terms from public.icash_deal_files d where e.deal_id=d.id and e.account_id=d.account_id and d.id=$1',[deal]);
 await db.query("insert into public.icash_operation_rates values($1,'title_email',true,now()+interval '30 days')",[rate]);
 await db.query("insert into public.icash_title_contacts values($1,$2,'closer@example.invalid',now()+interval '30 days','owner-closing-verification:fixture',$3,true)",[deal,account,rate]);
 await db.query("insert into public.icash_title_requests(id,deal_id,account_id,purchase_envelope_id,recipient,property_address,rate_id,verified_until,state,provider_id,delivered_assignment_ids,created_at) values($1,$2,$3,$4,'closer@example.invalid','Fixture title property',$5,now()+interval '30 days','sent','fixture-original-title-receipt',array[$6]::uuid[],now()-interval '2 hours')",[request,deal,account,purchase,rate,assignment]);
 await db.query("insert into public.icash_operation_spend(operation_key,account_id,rate_id,state,dispatched_at,permission_until) values($1,$2,$3,'settled',now()-interval '1 hour',now()+interval '30 days')",['title:'+request,account,rate]);
 return {account,deal,purchase,assignment,rate,request,property};
}
export async function sendTitleCopyReply(db,c,text,{email=randomUUID(),authenticated=true,sender='closer@example.invalid',legacy=false,source={}}={}){
 const metadata={providerReceivedAt:new Date().toISOString(),webhookEventId:'fixture-'+randomUUID(),bodyComplete:true,bodySha256:createHash('sha256').update(text).digest('hex'),...source};
 const args=[email,'T',c.request,sender,'Fixture title reply',text,authenticated];
 if(legacy)await db.query('select public.icash_record_title_reply($1,$2,$3,$4,$5,$6,$7)',args);
 else await db.query('select public.icash_record_title_reply_source($1,$2,$3,$4,$5,$6,$7,$8)',[...args,metadata]);
 return (await db.query('select * from public.icash_title_replies where provider_email_id=$1',[email])).rows[0];
}
export async function installTitleCopyMigration(db){
 const source=readFileSync('config/title-executed-copy-requests.sql','utf8');
 // The committed migration is compared once the complete disabled adapter is assembled.
 await db.exec('begin;'+source+'commit;');
 assert.equal((await db.query('select enabled from icash_title_copy_private.policy where id=1')).rows[0].enabled,false);
}
