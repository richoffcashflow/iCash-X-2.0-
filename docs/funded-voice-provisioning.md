# Reviewed production voice provisioning

## Scope and default state

`config/funded-voice-provisioning.sql` adds an empty, service-only singleton table,
`icash_voice_production_template`, and wraps the existing
`icash_provision_funded_account(uuid)` RPC. It does not seed an enabled template,
invent provider prices, alter credentials, or perform a backfill.

The existing funding trigger and account-load retry continue to call the same
RPC. The original discovery response fields remain intact; a separate `voice`
object reports `funding_required`, `reviewed_template_required`,
`practice_agent_blocked`, `full_call_rates_required`, `configured`, or
`existing_configuration_preserved`. Existing discovery failure statuses do not
prevent independently eligible voice configuration. Unexpected database errors
still abort the RPC transaction; the existing funding trigger catches them so a
confirmed payment is not lost.

A new account voice row requires all of the following:

- An existing live, paid, credited funding order for that account
- An explicitly enabled template with a current, finite review deadline and
  recorded review evidence
- A dedicated production agent ID, actual provider phone resource ID, exact
  SHA-256 hash of `JSON.stringify(agent.conversation_config)`, at least two
  distinct actual provider tool IDs, and only explicitly reviewed voice overrides
- Correct seller-call and buyer-call rate IDs; both must be enabled, already
  verified, unexpired, finite, and cover the entire configured 60–900-second cap
- All 16 known cost categories, each a nonnegative integer USD-micro amount, and
  a complete total within the JavaScript safe-integer range. Explicit zero means
  reviewed not-applicable cost; it must not stand in for an unknown cost

An empty approved-voice list permits no overrides. It does not authorize every
voice. Tool IDs are identifiers, not arbitrary descriptions such as “callback.”
The actual tool definitions, signed callback authentication, disclosures,
caller-ID continuity, forwarding and provider settings require separate review.

The new row copies only the reviewed template, with `reviewed_until` equal to the
earliest of template, seller-rate and buyer-rate expiry. This timestamp is the
latest configuration eligibility deadline, consistent with existing dispatch;
the quoted duration must separately cover a complete call. Provisioning is not
a reservation, credit charge, contact permission, offer authority or dispatch.
The existing dispatch, pause, wallet, suppression, financial-screening and
provider checks still apply.

## Existing rows and operator controls

Every existing account voice row is preserved byte-for-byte, including disabled,
expired and manually changed rows. Template changes apply only to future inserts.
Repeated funding, account loads and concurrent insert conflicts do not re-enable
an existing row. This intentionally means expired configurations require explicit
operator review rather than automatic renewal.

Disabling the template prevents future provisioning only. It is not a global
kill switch for existing account configurations. Use established account and
operating pause controls for an immediate stop. Do not delete disabled account
rows as a substitute for pausing them: deletion makes a later funding retry
eligible to create a fresh row.

Current practice configuration and recorded practice-session agent IDs are
rejected. Always create a dedicated production agent; never recycle a former
practice agent. Existing practice-session imports can have an in-flight read
during practice configuration rotation, so the history check is not a guarantee
against an uncommitted concurrent import of a recycled agent. Provider review
must verify the production agent has never been used for practice.

## Verification and migration plan

The actual migration and complete rollback fixture passed on 2026-09-30 using
PostgreSQL 18.3 in PGlite 0.5.8. This included direct RPC and funding-trigger
execution, real database roles/RLS grants, PL/pgSQL checks and rollback integrity.
The isolated database retained no fixture accounts, rates, voice configurations
or templates. No live database or provider was contacted.

The reproducible harness is `scripts/test-funded-voice-pglite.mjs`. It loads
relevant table definitions and functions directly from this repository, creates
minimal Supabase auth and unrelated foreign-key fixtures, then executes both SQL
files unchanged. The official `@electric-sql/pglite@0.5.8` package was installed
separately under `/tmp/icash-voice-pglite` with install scripts disabled; no project
dependency or lockfile was changed. With that existing package, rerun:

```sh
node scripts/test-funded-voice-pglite.mjs /tmp/icash-voice-pglite/node_modules/@electric-sql/pglite/dist/index.js
```

This verifies PostgreSQL behavior, but its single-connection embedded database and
minimal auth/FK scaffolding do not reproduce the complete deployed Supabase
schema, extensions, multi-session concurrency, advisors or provider behavior.
Those checks remain pending. The ordinary `npm test` suite checks SQL source
contracts only; it does not run this optional database harness.

This checkout has neither `psql` nor the Supabase CLI. A dated migration file must
still be allocated with the CLI in an authorized database-capable environment.

1. In an authorized database-capable environment, inspect the deployed schema
   and migration history first. The repository's `config/` files include later
   schema work not fully represented by the historical migration directory.
   Use a disposable staging copy of the current schema with no live worker or
   external dispatch. Required objects include the current operation-rate and
   funding schemas, `live-dispatch.sql`, `setup-voice-dispatch.sql`, practice
   configuration/session tables, and `funded-account-provisioning.sql` with its
   existing discovery dependencies. The funding trigger must already exist for
   the integration assertion in the rollback test.
2. Read `supabase --help`, check the installed CLI version, then use
   `supabase migration new funded_voice_provisioning` to allocate a filename.
   Put the reviewed config SQL into that generated file. Apply it only with
   explicit approval for that database. The SQL is transactional and intended
   to apply once; it preserves the former RPC as
   `icash_provision_before_voice_template(uuid)`.
3. Run `node --experimental-strip-types tests/funded-voice-provisioning.test.mjs`
   and `npm test` locally. These assert source contracts, not SQL execution.
4. The isolated embedded run is complete; after the migration is installed in
   disposable staging with the actual deployed schema, additionally run
   `psql "$STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/funded-voice-provisioning-database.sql`.
   Use an existing approved connection mechanism; never paste credentials into
   chat or commit them. The suite uses `BEGIN`/`ROLLBACK`, but temporarily disables
   existing data rates and changes singleton fixtures. Never run it in production.
   A successful run must print the PASS row and reach `ROLLBACK` without warnings
   about deferred provisioning. The tests cover both direct RPC and the existing
   funding trigger, actual service/authenticated role execution, no-funding/test/
   pending/uncredited holds, template review, current/historical practice agents,
   malformed rates on both sides, bounded expiry, manual holds and unchanged
   consent, offers, spending and pause state.
5. Run Supabase security/database advisors and the existing voice/discovery
   rollback suites against the same staging schema. Exercise two simultaneous
   provisioning calls for one account: expect one row and a preserved-row result.
   Also overlap a funding-order update and RPC retry; neither should deadlock.
6. Review the provider agent and both complete full-duration rate versions with
   current evidence. Only after separate operator authorization insert or enable
   the singleton template. Inserting it does not backfill accounts. An existing
   account requires an authorized RPC retry or its normal funding/account-load
   flow. Verify the resulting configuration with the read-only voice preflight,
   then separately complete an authorized end-to-end call test. Database
   configuration is not proof of a successful call or launch readiness.

If rollback is required before any account provisioning, remove the new wrapper,
rename `icash_provision_before_voice_template` back to the original RPC, and
remove the empty template table and its two validation helpers in one reviewed
transaction. Preserve the original service-only grants. If account rows were
already provisioned, first stop the affected accounts using existing controls
and review their rows individually; dropping the new schema does not remove or
disable already copied configurations. Do not blindly delete account rows.
