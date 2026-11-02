alter table icash_text_threads add column dnc_checked_at timestamptz default now();
alter table icash_text_messages alter column route_revision set default 1;
create table icash_sms_routes(sender text,recipient text,account_id uuid,revision bigint default 1,needs_review boolean default false,primary key(sender,recipient));
create table icash_handoffs(account_id uuid,screening_id uuid,state text);
create table icash_outreach_campaigns(account_id uuid,mode text);
create table icash_sms_inbound_invitations(account_id uuid,thread_id uuid,deal_id uuid,message_id uuid,called_number text,sender text,recipient text,expires_at timestamptz,reply_id uuid);
create table icash_seller_opener_assignments(account_id uuid,message_id uuid);
create table icash_inbound_voice_routes(called_number text,business_number text,enabled boolean,reviewed_until timestamptz,agent_config_hash text);
create function icash_seller_conversation_human(b text) returns boolean language sql immutable as $$select b ~* '\m(human|real person|speak to someone|talk to someone)\M'$$;
create function icash_seller_conversation_reply(a uuid,j uuid) returns text language sql as $$select null::text$$;
create function icash_sms_message_route_current(a uuid,mid uuid) returns boolean language sql set search_path=public as $$select exists(select 1 from icash_text_messages m join icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id join icash_sms_routes r on r.account_id=t.account_id and r.sender=t.sender and r.recipient=t.recipient where m.account_id=a and m.id=mid and not r.needs_review and m.route_revision=r.revision)$$;
create function icash_customer_authored_text(a uuid,m uuid) returns boolean language sql as $$select false$$;
create function icash_seller_recovery_nonprice_current(a uuid,m uuid) returns boolean language sql as $$select false$$;
create function icash_limited_seller_text_current(a uuid,m uuid) returns boolean language sql as $$select false$$;
create function icash_manual_handoff_reply(a uuid,t uuid) returns boolean language sql as $$select false$$;
create function icash_buyer_package_data(a uuid,d uuid) returns jsonb language sql as $$select null::jsonb$$;
create function icash_buyer_factual_text(a uuid,t uuid,b text) returns text language sql as $$select null::text$$;
create function icash_sms_inbound_campaign_current(a uuid) returns boolean language sql set search_path=public as $$select campaign from fixture_flags$$;
-- Keep the native atomic operation claim as the provider/budget delegate only.
alter function icash_claim_text(uuid,uuid,text) rename to fixture_provider_claim;
create function icash_claim_text_before_ai(p_account uuid,p_message uuid,p_sender text) returns jsonb language sql as $$select public.fixture_provider_claim(p_account,p_message,p_sender)$$;
create function icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql set search_path=public as $$begin
 if not exists(select 1 from icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message and analysis->>'dialoguePolicy'='seller-dialogue-v1') then return fixture_provider_claim(p_account,p_message,p_sender);end if;
 if not icash_sms_message_route_current(p_account,p_message) then return null;end if;
 return icash_claim_text_before_owner_question(p_account,p_message,p_sender);
end$$;
