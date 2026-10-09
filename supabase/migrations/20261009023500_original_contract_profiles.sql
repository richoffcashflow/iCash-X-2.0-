-- New templates use only the fields on the owner's uploaded one-page originals.
-- Previously issued envelopes retain their original template and legal wording.
alter table public.icash_signing_templates add column form_profile text not null default 'legacy'
 check(form_profile in ('legacy','owner_original_20261009'));
