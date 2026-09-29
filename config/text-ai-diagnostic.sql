alter table public.icash_text_diagnostics add column ai_input text check(length(ai_input)<=1000);
alter table public.icash_text_diagnostics add column ai_result jsonb;
alter table public.icash_text_diagnostics add column error_code text;
