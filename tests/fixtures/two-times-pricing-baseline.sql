-- Production question admission before the universal 2x policy.
CREATE OR REPLACE FUNCTION public.icash_reserve_question(p_account uuid, p_question uuid, p_model text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 if p_model is distinct from 'gpt-4.1-mini' or not exists(select 1 from public.icash_workspace_questions where id=p_question and account_id=p_account and state='pending') then raise exception 'Question binding required';end if;
 if exists(select 1 from public.icash_question_usage where question_id=p_question) then return false;end if;
 insert into public.icash_question_usage(question_id,account_id,model,multiplier) values(p_question,p_account,p_model,case when public.icash_vip_active(p_account) then 2.4 else 3 end);
 perform public.icash_reserve_credit(p_account,'question:'||p_question,5);
 return true;
end $function$;
