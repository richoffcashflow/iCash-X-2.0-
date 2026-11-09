create role anon;create role authenticated;create role service_role;
create table icash_operating_budget(id integer primary key);insert into icash_operating_budget values(1);
create table icash_accounts(id uuid primary key,owner_user_id uuid);
create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text default 'draft',terms jsonb default '{}');
create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,retired_at timestamptz,blocked boolean default false);
create table icash_text_messages(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid references icash_text_threads(id),direction text,state text,body text,customer_author_id uuid,request_key uuid unique,created_at timestamptz default now(),updated_at timestamptz default now());
create table icash_workspace_questions(id uuid primary key,account_id uuid,state text default 'complete',answer jsonb,completed_at timestamptz default now(),archived_at timestamptz);
create table fixture_receipts(message_id uuid unique);
create function icash_queue_customer_text(p_actor uuid,p_account uuid,p_thread uuid,p_key uuid,p_body text,p_assets uuid[]) returns jsonb language plpgsql set search_path=public as $$declare m uuid;begin
 if exists(select 1 from icash_text_threads where id=p_thread and blocked) then return '{"error":"Contact is blocked"}';end if;
 insert into icash_text_messages(account_id,thread_id,direction,state,body,customer_author_id,request_key) values(p_account,p_thread,'outgoing','ready',p_body,p_actor,p_key) returning id into m;
 return jsonb_build_object('id',m,'manual',true);
end $$;
create function icash_claim_customer_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql set search_path=public as $$begin
 update icash_text_messages m set state='dispatching' where m.id=p_message and m.account_id=p_account and m.state='ready' and not exists(select 1 from icash_text_threads t where t.id=m.thread_id and t.blocked);
 if not found then return null;end if;insert into fixture_receipts values(p_message);return jsonb_build_object('id',p_message);
end $$;
