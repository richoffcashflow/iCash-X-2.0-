CREATE OR REPLACE FUNCTION public.icash_settle_question(p_account uuid, p_question uuid, p_provider text, p_input bigint, p_cached bigint, p_output bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare q public.icash_question_usage;cost bigint;price bigint;carry bigint;charge bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 select * into strict q from public.icash_question_usage where question_id=p_question and account_id=p_account for update;
 if q.state<>'reserved' then
  if row(q.provider_id,q.input_tokens,q.cached_tokens,q.output_tokens) is distinct from row(p_provider,p_input,p_cached,p_output) then raise exception 'Question settlement changed';end if;return q.charged_cents;
 end if;
 if p_provider is null then
  perform public.icash_finish_credit(p_account,'question:'||p_question,0,'AI response has no verified usage; customer not charged');
  update public.icash_question_usage set state='unverified',charged_cents=0,settled_at=now() where question_id=q.question_id;return 0;
 end if;
 if p_provider !~ '^chatcmpl-[A-Za-z0-9_-]+$' or p_input is null or p_input not between 0 and 32000 or p_cached is null or p_cached not between 0 and p_input or p_output is null or p_output not between 0 and 150 then raise exception 'Invalid provider token receipt';end if;
 -- GPT-4.1 mini standard tier: $0.40 input / $0.10 cached / $1.60 output per 1M tokens.
 -- Official model pricing checked 2026-10-07. No tools, images or batch calls.
 cost:=ceil((p_input-p_cached)*0.4+p_cached*0.1+p_output*1.6);
 price:=ceil(cost*q.multiplier);
 insert into public.icash_fractional_credit_carry(account_id) values(p_account) on conflict do nothing;
 select remaining_micros into carry from public.icash_fractional_credit_carry where account_id=p_account for update;
 charge:=(carry+price)/10000;
 if charge>5 then raise exception 'Question price exceeds its reservation';end if;
 perform public.icash_finish_credit(p_account,'question:'||p_question,charge,'OpenAI token receipt '||p_provider);
 update public.icash_fractional_credit_carry set remaining_micros=mod(carry+price,10000) where account_id=p_account;
 update public.icash_question_usage set state='settled',provider_id=p_provider,input_tokens=p_input,cached_tokens=p_cached,output_tokens=p_output,cost_micros=cost,price_micros=price,charged_cents=charge,settled_at=now() where question_id=q.question_id;
 return charge;
end $function$;
