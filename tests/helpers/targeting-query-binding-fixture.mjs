import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const account='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',revision='00000000-0000-4000-8000-000000000003',rate='00000000-0000-4000-8000-000000000004';
export const definition={id:'00000000-0000-4000-8000-000000000010',segment:'vacant_absentee',asOf:'2026-10-30'};
export const plan={version:'seller-targeting-v1',strategy:'target_'+definition.id,providerPage:1,mode:'explore',targeting:definition};
export const scope={p_zip:'75217',p_revision:revision,p_page:1,p_per_page:5,p_rate:rate,p_unit:10000,p_permission_until:'2099-01-01T00:00:00Z',p_setup_revision:1,p_market_mode:'city',p_market:'75217'};
export const policy={version:'research-efficiency-v2',exclusionListId:'fixture-list'};
export const originalDefinitions=JSON.parse(read('tests/fixtures/targeting-query-binding-before.json'));
export const migration=read('config/targeting-verified-query-binding.sql');
export const setupSql=read('tests/fixtures/targeting-schema.sql')+`
 alter table icash_operation_spend add primary key(operation_key);
 create table icash_operation_rates(id uuid,operation text,enabled boolean,expires_at timestamptz);
 create table icash_bot_setups(account_id uuid,revision integer,profile jsonb);
 create table icash_wallets(account_id uuid,balance_cents bigint,reserved_cents bigint);
 create table icash_market_shortlist(zip text,state text);
 create table icash_property_zip_geographies(zip text,state_code text,property_count bigint,checked_at timestamptz,expires_at timestamptz);
 create table icash_inventory_markets(account_id uuid,zip text,next_scan_at timestamptz);
 create table icash_research_private.settings(id int,enabled boolean,exclusions_enabled boolean,exclusion_sync_enabled boolean,pruned_at timestamptz);
 create table icash_research_private.query_claims(operation_key text primary key,account_id uuid,policy jsonb);
 create table icash_research_private.estimates(operation_key text,account_id uuid,query jsonb);
 create function icash_stalled_search_configuration(uuid,text) returns jsonb language sql as $$select null::jsonb$$;
 create table fixture_gates(name text primary key,allowed boolean);
 insert into fixture_gates values('funds',true),('membership',true),('market',true),('stalled',false),('due',true);
 create function icash_filter_state_before_request_reuse(uuid,uuid,integer) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_filter_sms_interest(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_learning_deal_outcomes(uuid) returns table(deal_id uuid,screening_id uuid,purchase_at timestamptz,assignment_at timestamptz,closed_at timestamptz) language sql as $$select null::uuid,null::uuid,null::timestamptz,null::timestamptz,null::timestamptz where false$$;
 create function icash_call_has_seller_response(jsonb) returns boolean language sql as $$select false$$;
 create function icash_call_selling_interest(jsonb) returns boolean language sql as $$select false$$;
 create function icash_seller_contact_stop(text) returns boolean language sql as $$select false$$;
 create function icash_seller_sms_interest_at(uuid,uuid,timestamptz,timestamptz) returns timestamptz language sql as $$select null::timestamptz$$;
 create function icash_known_assigned_discovery_page(text,text,int,int) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_known_assigned_research_page(text,text,int,int,jsonb) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_reserve_and_claim_property_discovery(uuid,text,uuid,int,int,uuid,bigint,timestamptz,int,text,text) returns boolean language sql as $$select false$$;
 create function icash_owner_active_export_enabled() returns boolean language sql as $$select true$$;
 create function icash_dealmachine_capacity_available(int) returns boolean language sql as $$select true$$;
 create function icash_research_zip_known(text) returns boolean language sql as $$select allowed from public.fixture_gates where name='market'$$;
 create function icash_stalled_research_zip(uuid,text) returns boolean language sql as $$select allowed from public.fixture_gates where name='stalled'$$;
 create function icash_outbound_search_due(uuid) returns boolean language sql as $$select allowed from public.fixture_gates where name='due'$$;
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select allowed from public.fixture_gates where name='membership'$$;
 create function icash_expand_inventory_markets(uuid) returns integer language sql as $$select 0$$;
 create function icash_rotate_inventory_market(uuid) returns boolean language sql as $$select false$$;
 create function icash_mark_inventory_empty(uuid,uuid,integer) returns void language sql as $$select$$;
 create function icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) returns void language plpgsql as $$begin
  if not (select allowed from public.fixture_gates where name='funds') or not public.icash_membership_work_allowed($1)
   or not exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id where a.id=$1 and not a.bot_paused and w.balance_cents>w.reserved_cents) then raise exception 'Fixture financial hold';end if;
  insert into public.icash_operation_spend(operation_key,account_id,rate_id,permission_until,state) values($2,$1,$3,$4,'reserved') on conflict(operation_key) do nothing;
 end$$;
 create function icash_claim_operation(text) returns boolean language plpgsql as $$begin
  update public.icash_operation_spend set state='dispatched',dispatched_at=now() where operation_key=$1 and state='reserved';return found;end$$;
 `+JSON.parse(read('tests/fixtures/targeting-exclusions-before.json')).filter(f=>f.proname!=='icash_reserve_research_discovery').map(f=>f.definition+';').join('\n')
 +JSON.parse(read('tests/fixtures/targeting-before.json')).filter(f=>!['icash_prepare_research_efficiency','icash_record_discovery_inventory'].includes(f.proname)).map(f=>f.definition+';').join('\n')
 +read('config/dealmachine-targeting-experiments.sql')+read('config/dealmachine-targeting-learning.sql')
 +originalDefinitions.filter(f=>!['icash_targeting_state','icash_targeting_dedup_ready','icash_claim_discovery_estimate','icash_record_discovery_inventory','icash_finish_research_exclusions'].includes(f.proname)).map(f=>f.definition+';').join('\n');
export const seedSql=`
 insert into icash_research_private.settings values(1,true,false,true,now());
 insert into icash_accounts(id,owner_user_id,bot_paused) values('${account}','${account}',false),('${other}','${other}',false);
 insert into icash_wallets values('${account}',10000,0),('${other}',10000,0);
 insert into icash_operating_budget(id) values(1);
 insert into icash_market_shortlist values('75217','TX'),('90210','CA');
 insert into icash_bot_setups values('${account}',1,'{"marketMode":"city","market":"75217"}'),('${other}',1,'{"marketMode":"city","market":"75217"}');
 insert into icash_operation_rates(id,operation,enabled,expires_at) values('${rate}','property_search',true,'2099-01-01');
 insert into icash_discovery_configs(account_id,enabled,auto_enabled,zip,rate_id,property_credit_micros,data_rights_until,per_page,next_page,revision,exhausted,research_version,research_list_id)
 values('${account}',true,true,'75217','${rate}',10000,'2099-01-01',5,1,'${revision}',false,2,null),('${other}',true,true,'75217','${rate}',10000,'2099-01-01',5,1,'${other}',false,2,null);
 insert into icash_discovery_filter_settings values(1,true);
 insert into icash_discovery_filter_cursors(account_id,revision,zip,strategy,next_page,exhausted,pages)
 values('${account}','${revision}','75217','baseline',1,false,0),('${account}','${revision}','75217','target_${definition.id}',1,false,0),('${other}','${other}','75217','baseline',1,false,0);
 insert into icash_research_private.exclusions(id,name,list_id,state,last_synced_at) values(1,'research-exclusions-fixture','fixture-list','ready',now());
 insert into icash_integration_checks(provider,checked_at,result) values('dealmachine_targeting',now(),jsonb_build_object('status','verified','checkedAt',now(),'plan','{"name":"Fixture","is_paid":true}'::jsonb,'filters','[{"filter_id":"is_vacant_home","type":"BOOLEAN","allowed_operators":[],"is_premium_filter":false},{"filter_id":"has_absentee_owners","type":"BOOLEAN","allowed_operators":[],"is_premium_filter":false}]'::jsonb));
 select icash_configure_targeting('592171a0-2bb9-484e-8c9a-dd5d2b43b5f7','set_experiment','${JSON.stringify(definition)}',true);
 select icash_configure_targeting('592171a0-2bb9-484e-8c9a-dd5d2b43b5f7','set_enabled',null,true);
`;
export const activateSql="update icash_research_private.targeting_query_settings set enabled=true,list_id='fixture-list',release_sha=repeat('a',40),activated_at=now() where id=1;";
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify({setupSql,seedSql,migration,activateSql,account,other,revision,rate,plan,scope,policy}));
