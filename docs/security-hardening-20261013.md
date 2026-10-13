# Dashboard access and dependency hardening

Owner dashboard pages now require the existing verified account session plus a password recheck. The check uses Supabase's password grant for the signed-in user's canonical email, confirms the same user, revokes that temporary grant's refresh session, and leaves the original login intact. Passwords are neither stored by the application nor returned to the client. Five attempts per user/IP per 15 minutes are admitted through the existing durable rate limiter.

The unlock lasts one hour, or 30 days when the user selects Remember this device (selected by default). It is an HMAC-signed, Secure, HttpOnly, SameSite=Strict, host-only cookie. It is bound to the original authenticated user and session ID. Refreshing an access token within that session preserves the unlock; a new session, altered proof, missing key, or expired proof fails closed. Logout and Lock dashboard expire it with the same Secure/host-only cookie attributes. This is password reauthentication, not MFA.

Proxy redirects locked page visits, but is not the API authorization boundary. Owner user/account guards, the webinar owner adapter, trusted-operator guard, and private voice-test guard independently enforce the proof before sensitive access. Existing account ownership, operator scopes, paid access and provider webhook controls still apply. Ordinary customer work, public webinar registration, HomeOffer intake, cron and provider callbacks do not require a dashboard password. Ad measurement is suppressed on dashboard and unlock pages.

Global headers add framing denial, MIME sniffing protection, referrer controls, microphone/camera/payment restrictions and a static-compatible CSP. CSP restricts script/frame hosts and blocks objects and external base URLs. Inline Next hydration scripts and existing inline styles remain allowed; this is not a strict nonce CSP. Stripe checkout, Google address lookup, uploaded videos, Supabase storage, and Twilio/ElevenLabs audio origins are included. Existing stronger route-level policies remain in place.

Next.js is patched to 16.3.8 and React to 19.2.8. Vulnerable transitive versions are pinned in pnpm-workspace.yaml. Removed unused vinext and eslint-config-next dependencies: the repository has no Vite/vinext or ESLint configuration/commands, and builds using native Next.js. Those unused packages were the last paths to an unpatched braces advisory. No advisory is ignored or suppressed. Full and production package audits must be checked after lockfile resolution.

Validation includes password failure/rate limits, origin checks, cross-user/session binding, tampering, expiry, temporary-session revocation, secure cookie clearing, direct API guards, route coverage, production compilation and the existing local release checks. Tests use local fixtures; no paid calls, messages, or provider simulations are performed.

Supabase leaked-password protection is a separate hosted Auth setting. It must be enabled and verified in the authenticated Supabase dashboard; application code and SQL migrations do not substitute for that setting. Do not mark it enabled until the live advisor confirms it.

On October 13, 2026 leaked-password protection was enabled in the production Supabase Email provider. The live security advisor no longer reports the disabled-protection warning.

Set or change password uses a fresh email OTP sent only to the authenticated principal's canonical email. The verified OTP session must belong to that principal before updating through Supabase Auth; leaked-password checks stay enforced. Failed verification sessions are revoked, and successful changes save the fresh session and bind the unlock to it. Password and code values are not logged or stored by the application.
