-- Isolated native/PGlite prerequisites. No provider calls or production configuration.
create schema icash_learning_policy_private;
 create table icash_learning_policy_private.settings(id int primary key,enabled boolean,policy_version text,release_sha text,activated_at timestamptz,evidence_after timestamptz);
 insert into icash_learning_policy_private.settings values(1,false,'evidence-v2',null,null,now()-interval '1 day');
 create table icash_learning_policy_private.sms_settings(id int primary key,enabled boolean);insert into icash_learning_policy_private.sms_settings values(1,false);
 create table icash_learning_policy_private.decisions(id bigint generated always as identity primary key,domain text,context text,market text,policy_version text,decision jsonb,stats jsonb,choices text[],require_contracts boolean,evidence_hash text,created_at timestamptz default now());
 create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
 create table icash_learning_assignments(account_id uuid,domain text,subject text,context text,market text,variant text,mode text,learning_decision_id bigint,learning_policy_version text,learning_selection_mode text,primary key(account_id,domain,subject));
 create table icash_seller_opener_assignments(thread_id uuid primary key,learning_context text,variant text,learning_decision_id bigint,learning_policy_version text,learning_selection_mode text);
