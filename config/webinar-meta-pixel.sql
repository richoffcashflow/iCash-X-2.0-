-- Owner-supplied Meta Pixel, October 16, 2026. Change only Meta configuration.
-- Browser measurement retains the viewer's choice and excludes previews.
-- Server delivery still requires its separately configured API credentials.
update public.icash_webinar_settings
set config=jsonb_set(config,'{meta}','{"enabled":true,"pixelId":"1104248230721457"}'::jsonb),
    updated_at=now()
where id=1;
