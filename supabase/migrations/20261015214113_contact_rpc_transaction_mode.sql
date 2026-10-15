-- Consent evidence uses SELECT FOR SHARE to keep its account/property binding
-- consistent. PostgREST runs STABLE RPCs in READ ONLY transactions, even for
-- POST, so each contact entry point must permit those existing row locks.
-- Preserve every function body, grant, consent check and contact limit.
alter function public.icash_manual_contacts(uuid,uuid) volatile;
alter function public.icash_manual_contact_reason(uuid,uuid,text,text,uuid) volatile;
alter function public.icash_customer_call_sender(uuid,uuid,text) volatile;
alter function public.icash_manual_text_reason(uuid,uuid,uuid) volatile;

notify pgrst, 'reload schema';
