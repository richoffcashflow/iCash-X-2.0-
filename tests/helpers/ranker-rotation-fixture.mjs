import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
export const setupSql=read('tests/fixtures/shared-learning-schema.sql')+`
 alter table icash_screening_jobs add primary key(id);
 create function icash_opportunity_score(uuid,jsonb,text) returns numeric language sql as $$select 0.5::numeric$$;
 create function icash_refresh_learning_account(uuid) returns void language sql as $$select$$;
 create function icash_seller_sms_interest_at(uuid,uuid,timestamptz,timestamptz) returns timestamptz language sql as $$select null::timestamptz$$;
 create function icash_platform_learning_report(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
`+read('supabase/migrations/20261021185044_platform_shared_learning_schema.sql')
 +read('supabase/migrations/20261027035912_outcome_ranker.sql')
 +read('config/ranker-evidence-and-temporal-sampling.sql');
export const seedSql=`
 insert into icash_accounts(id) select md5('rotation-account-'||a)::uuid from generate_series(1,40) a;
 insert into icash_screening_jobs(id,account_id,state)
 select md5('rotation-'||a||'-'||b||'-'||n)::uuid,md5('rotation-account-'||a)::uuid,'pending'
 from generate_series(1,40) a cross join generate_series(0,3) b cross join generate_series(1,80) n;
 insert into icash_ranker_private.samples(screening_id,account_id,property_key,features,observed_at,captured_at,baseline,cohort,exposed_at,interest,contract,closing,refreshed_at)
 select md5('rotation-'||a||'-'||b||'-'||n)::uuid,md5('rotation-account-'||a)::uuid,'rotation-'||a||'-'||b||'-'||n,
 array_fill(0::double precision,array[12]),now()-interval '230 days',now()-interval '229 days',0.5,'collecting',
 now()-case b when 0 then interval '200 days' when 1 then interval '70 days' when 2 then interval '35 days' else interval '5 days' end-n*interval '1 minute',
 0,case when b<=2 then 0 end,case when b<=1 then 0 end,now()
 from generate_series(1,40) a cross join generate_series(0,3) b cross join generate_series(1,80) n;
 update icash_ranker_private.settings set enabled=true;
`;
export const patch=read('config/ranker-continuous-evidence.sql');
