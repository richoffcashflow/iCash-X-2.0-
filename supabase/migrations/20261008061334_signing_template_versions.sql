begin;
-- Keep issued envelopes bound to their original template record. Only the
-- current enabled version competes for new signing requests.
drop index public.icash_standard_template_kind_signers_mode;
drop index public.icash_state_template_state_kind_signers_mode;
create unique index icash_standard_template_kind_signers_mode
 on public.icash_signing_templates(kind,signer_count,test_mode) where template_scope='standard' and enabled;
create unique index icash_state_template_state_kind_signers_mode
 on public.icash_signing_templates(state_code,kind,signer_count,test_mode) where template_scope='state' and enabled;
commit;
