import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const before=JSON.parse(read('tests/fixtures/policy-review-lock-before.json'));
export const migration=read('config/policy-review-lock-isolation.sql');
export const value=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
export const setup=read('tests/fixtures/learning-refresh-concurrency.sql')
 +read('config/learning-refresh-concurrency.sql')
 +read('tests/fixtures/learning-operations-monitor.sql')
 +read('config/learning-operations-review.sql')
 +read('tests/fixtures/learning-policy-lifecycle.sql')
 +`alter table public.icash_seller_opener_assignments add column account_id uuid,add column body text;
 create function public.icash_shared_learning_stats(text,text,text) returns jsonb language sql as $$select '[]'::jsonb$$;
 create function public.icash_seller_sms_learning_plan(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function public.icash_seller_cash_question_plan(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;`
 +read('config/learning-policy-lifecycle.sql')
 +before.functions.map(f=>f.definition+';').join('\n');
export const decision=(market='*')=>`insert into icash_learning_policy_private.decisions(domain,context,market,policy_version,decision,stats,choices,require_contracts,evidence_hash)
 values('seller_sms','cash-question-v6','${market}','evidence-v2','{"status":"explore","allowedChoices":["a","b"]}','[]',array['a','b'],false,gen_random_uuid()::text) returning id`;
export const snapshot=`select coalesce(jsonb_agg(to_jsonb(x) order by domain,context,market,policy_version),'[]'::jsonb) from icash_learning_private.policy_cohorts x`;
