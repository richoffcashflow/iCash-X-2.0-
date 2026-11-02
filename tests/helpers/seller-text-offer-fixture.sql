create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now());
alter table icash_accounts add column owner_user_id uuid;
alter table icash_deal_files add column updated_at timestamptz default now();
alter table icash_signing_envelopes add column terms jsonb,add column recipients jsonb;
alter table icash_text_messages add column asset_ids uuid[] default '{}';
create table icash_text_assets(id uuid,account_id uuid,deal_id uuid,url text,bytes bigint,verified_until timestamptz);
create function icash_sms_single_segment(b text) returns boolean language sql immutable as $$select length(b)<=160 and b !~ '[^\x00-\x7F]'$$;
create table icash_customer_identities(account_id uuid primary key,principal text);
create table icash_call_recordings(account_id uuid,screening_id uuid,party text,dial_claimed_at timestamptz,call_ended_at timestamptz);
create table icash_deal_journeys(id uuid default gen_random_uuid(),account_id uuid,deal_id uuid,thread_id uuid,state text);
create schema icash_call_offer_private;
create table icash_call_offer_private.offers(deal_id uuid primary key,account_id uuid,version bigint default 1,state jsonb,snapshot jsonb,updated_at timestamptz default now());
create table icash_call_offer_private.events(id uuid default gen_random_uuid(),deal_id uuid,account_id uuid,call_key text,action text,state jsonb,created_at timestamptz default now());
create schema icash_seller_agreement_private;
create table icash_seller_agreement_private.confirmations(id uuid default gen_random_uuid(),call_key text unique,account_id uuid,deal_id uuid,confirmation jsonb,terms jsonb,envelope_id uuid,state text,created_at timestamptz default now());
-- Invoke the production admission chain for these messages as well as dialogue.
create or replace function icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql set search_path=public as $$begin
 if not exists(select 1 from icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message and (analysis->>'dialoguePolicy'='seller-dialogue-v1' or analysis->>'offerPolicy'='seller-text-offer-v1' or analysis->>'factualPolicy'='approved-package-v1')) then return fixture_provider_claim(p_account,p_message,p_sender);end if;
 if not icash_sms_message_route_current(p_account,p_message) then return null;end if;
 return icash_claim_text_before_owner_question(p_account,p_message,p_sender);
end$$;

drop function public.icash_queue_text(uuid,uuid,uuid,text,uuid[]);
