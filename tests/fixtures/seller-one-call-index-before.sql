CREATE UNIQUE INDEX icash_voice_operational_first_once ON public.icash_voice_jobs USING btree (operational_contact_id) WHERE ((callback_id IS NULL) AND (cancellation_notice_id IS NULL));
