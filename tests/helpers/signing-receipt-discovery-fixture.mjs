import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const originalSelector=JSON.parse(read('tests/fixtures/outreach-receipt-priority-baseline.json')).icash_next_before_voice_dispatch.replaceAll('FUNCTION public.icash_next_before_voice_dispatch()','FUNCTION public.icash_issue_due_signing_result()').replace('return public.icash_next_before_signing();','return null;');
const signing=read('supabase/migrations/20260929001207_ordered_contract_signing.sql'),cancellation=read('supabase/migrations/20261010045243_agreement_cancellation.sql');
const extract=(source,name)=>source.match(new RegExp('create (?:or replace )?function public\\.'+name+'\\([\\s\\S]*?end \\$\\$;','i'))?.[0]??(()=>{throw Error('Missing fixture source '+name);})();
const allowed=cancellation.match(/create function public\.icash_signing_action_allowed\([\s\S]*?\$\$;/)?.[0];
const cancelledSaver=cancellation.slice(cancellation.indexOf('alter function public.icash_save_signing_status'),cancellation.indexOf('create or replace function public.icash_buyer_is_reserved'));
export const setup=`
do $$begin create role anon;exception when duplicate_object then null;end$$;
do $$begin create role authenticated;exception when duplicate_object then null;end$$;
do $$begin create role service_role;exception when duplicate_object then null;end$$;
create table public.icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean not null default false);
create table public.icash_operating_budget(id int primary key);insert into public.icash_operating_budget values(1);
create table public.icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb);
create table public.icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,terms jsonb,stage text default 'draft',seller_signed_at timestamptz,assignment_signed_at timestamptz,updated_at timestamptz default now());
create table public.icash_property_controls(account_id uuid,property_id text,manual boolean default false,updated_at timestamptz default now(),primary key(account_id,property_id));
create table public.icash_signing_templates(id uuid primary key,provider text default 'docuseal',enabled boolean default true,reviewed_until timestamptz default now()+interval '60 days');
create table public.icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text default 'purchase',template_id uuid,terms jsonb,terms_hash text,recipients jsonb,test_mode boolean default false,requested_by uuid,consent_version text default 'fixture',provider_id text unique,state text default 'awaiting_counterparty',provider_status text default 'Created',provider_evidence jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),next_poll_at timestamptz default now(),last_poll_at timestamptz,unique(deal_id,kind,test_mode));
create table public.icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,signing_id uuid,screening_id uuid,live_call_id uuid,voice_job_id uuid,fulfillment_job_id uuid,title_task_id uuid,text_ai_job_id uuid,market_research_job_id uuid,token text unique default gen_random_uuid()::text||gen_random_uuid()::text,state text default 'issued',created_at timestamptz default now(),expires_at timestamptz default now()+interval '2 minutes',completed_at timestamptz,outcome text,
 constraint icash_automation_tickets_kind_check check(kind in ('customer_updates','discovery','contacts','voice_result','signing_result','voice_dispatch','fulfillment','title_followup','text_ai','market_research','seller_opener','seller_recovery','account_reconcile')));
create table public.icash_agreement_cancellations(id uuid primary key,account_id uuid,deal_id uuid,state text,snapshot jsonb,requires_release boolean default false,late_activity boolean default false,provider_checks jsonb default '{}');
create table public.icash_operation_spend(operation_key text primary key,account_id uuid,state text,charged_cents bigint);
create table public.icash_signature_authorizations(envelope_id uuid,account_id uuid,state text,signature_text text);
${originalSelector};
${extract(signing,'icash_claim_signing_poll')}
${extract(signing,'icash_save_signing_status')}
${allowed}
${extract(cancellation,'icash_guard_cancelled_signing')}
create trigger icash_cancelled_signing_guard before update on public.icash_signing_envelopes for each row execute function public.icash_guard_cancelled_signing();
${cancelledSaver}
revoke all on function public.icash_issue_due_signing_result(),public.icash_claim_signing_poll(uuid,uuid),public.icash_save_signing_status(uuid,text,jsonb),public.icash_signing_action_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_issue_due_signing_result(),public.icash_claim_signing_poll(uuid,uuid),public.icash_save_signing_status(uuid,text,jsonb),public.icash_signing_action_allowed(uuid,uuid) to service_role;
`;
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const value=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
export async function seed(db,n,{age=0,state='awaiting_counterparty',provider=String(n+1000),test=false}={}){
 const account=id(n),deal=id(n+10000),envelope=id(n+20000),template=id(n+30000),actor=id(n+40000),terms={seller:'Fixture seller',buyer:'Fixture principal',state:'TX',priceCents:100000,closingDate:'2027-01-15'},recipients=[{id:'1',email:'seller@example.invalid'},{id:'2',email:'owner@example.invalid'}];
 await db.query('insert into icash_accounts(id,owner_user_id) values($1,$2)',[account,actor]);
 await db.query('insert into icash_screening_jobs values($1,$2,$3)',[deal,account,{propertyId:deal}]);
 await db.query('insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$1,$3)',[deal,account,terms]);
 await db.query('insert into icash_signing_templates(id) values($1)',[template]);
 await db.query("insert into icash_signing_envelopes(id,account_id,deal_id,template_id,terms,terms_hash,recipients,requested_by,provider_id,state,test_mode,created_at) values($1,$2,$3,$4,$5,repeat('a',64),$6,$7,$8,$9,$10,now()-$11::int*interval '1 day')",[envelope,account,deal,template,terms,JSON.stringify(recipients),actor,provider,state,test,age]);
 await db.query("insert into icash_operation_spend values($1,$2,'dispatched',null)",['signing:'+envelope,account]);
 return {account,deal,envelope,template,actor,provider,terms,recipients,hash:'a'.repeat(64),test};
}
export const receipt=(row,state='awaiting_counterparty')=>({id:row.provider,test_mode:row.test,metadata:{icash_envelope:row.envelope,terms_hash:row.hash},status:state.includes('completed')?'Completed':'Pending',apply_signing_order:true,recipients:row.recipients.map((r,i)=>({...r,status:state.includes('completed')||state==='customer_signature_needed'&&i===0?'signed':'awaiting',signing_order:i+1}))});

export const original=async(db,r)=>({...await value(db,'select to_jsonb(e) from icash_signing_envelopes e where id=$1',[r.envelope]),state:'creating',provider_id:null,provider_status:null,provider_evidence:null});
