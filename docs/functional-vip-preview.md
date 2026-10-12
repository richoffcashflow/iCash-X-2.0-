# Functional admin preview and bot customization

The owner requested usable VIP preview features and Standard bot-name customization on October 11, 2026.

Menu → Preview VIP workspace now saves a server-authorized, account-bound preview. VIP exposes the real Ask AI Bot, buyer network/settings/demand, and custom voice controls. Standard and Exit revoke preview feature access. A preview expires after four hours and cannot override an expired workspace subscription. Customer plan changes still require the existing verified payment flow.

Workspace → Customize bot opens a compact dialog with the current bot name. Both Standard and VIP can rename their bot; the account name and setup profile update together. VIP includes the existing private voice upload, recording playback, consent, and enable/disable controls. The same dialog is available from the account menu. Bot names are no longer advertised as VIP-only, and initial bot creation allows a Standard name.

The feature predicate is deliberately separate from paid VIP. Preview does not change Stripe, membership prices, usage multipliers, lead priority, credits or recorded savings. Real actions use existing usage billing and communication consent controls. Preview does not create a voice, send a package or place a call just by opening it.

Migration: `20261012034706_functional_vip_preview.sql`, applied and verified on the existing production project. The preview table has RLS and service-only privileges; the setter reuses the existing platform-owner check. No browser-supplied account or user ID is accepted.

Verification: production build and TypeScript; focused workspace UI, account/access, preview/name routes, setup, custom voice, buyer network, assistant, membership/VIP billing and paid-test protection tests. Local Postgres fixtures cover authorization, account binding, preview expiry, subscription expiry, actual custom voice selection, Standard naming and unchanged wallet/membership rows. A rolled-back production transaction exercised owner VIP/Standard/Exit plus live buyer-network and demand reads; no preview row or balance change persisted. Existing security advisor notices are unchanged. Browser screenshot verification was unavailable in the execution environment. No paid provider simulations, calls, texts, emails or voice clones were run.
