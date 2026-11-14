import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const setupSql=[
 'tests/fixtures/learning-refresh-concurrency.sql','config/learning-refresh-concurrency.sql',
 'tests/fixtures/learning-operations-monitor.sql','config/learning-operations-review.sql',
].map(read).join('\n');
export const migration=read('config/learning-timeout-isolation.sql');
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const seedSql=`
 insert into public.icash_accounts select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3)n;
 insert into public.fixture_outcomes(account_id) select id from public.icash_accounts;
 insert into public.icash_learning_queue(account_id,due_at) select id,now()-interval '4 minutes'+row_number() over(order by id)*interval '1 second' from public.icash_accounts;
 insert into public.icash_learning_conversion_cache(id,report) values(1,'{}');
`;
export const refreshDefinition=(statement='')=>`
 create or replace function public.icash_refresh_learning_account(p_account uuid) returns void language plpgsql as $$begin
  update public.fixture_outcomes set value=value+1 where account_id=p_account;
  ${statement}
 end$$;
`;
export const cancelSecond=refreshDefinition(`if p_account='${id(2)}' then raise exception using errcode='57014',message='Synthetic cancellation';end if;`);
