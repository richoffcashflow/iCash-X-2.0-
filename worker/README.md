# Railway worker

Set Railway's root directory to `/worker`, Dockerfile path to `/worker/Dockerfile`, and start command to `node index.mjs`. The Dockerfile copies only the standby worker and avoids installing the web app's dependencies. The health endpoint is `/health` and reports `standby`. This deploy connects Railway to the source repository, but does not process jobs, contact sellers, or charge credits.

Before enabling work, add a durable queue, transactional customer/vendor ledgers, idempotent dispatch, provider credentials, verified consent and suppression records, approved jurisdiction policies, webhook verification, pause controls, observability, and failure handling. Release each sending channel only after a reviewed test. The Vercel app must remain informational until authentication and payment webhook settlement are implemented.
