# Production release gate

Vercel's production build runs `node scripts/verify-production-release.mjs` before the verified application build. Railway's production pre-deploy runs the same script with `--railway`; its image must include the script. A failure exits nonzero and prevents that deployment from proceeding.

The gate requires the host's full Git SHA, the `main` branch, and `richoffcashflow/iCash-X-2.0-` repository metadata. Vercel also requires its GitHub provider metadata. Railway requires `RAILWAY_ENVIRONMENT_NAME=production`, including when `--railway` is specified. CLI/image deployments without GitHub source metadata are blocked rather than borrowing another commit's checks.

It calls GitHub's public, read-only workflow runs API for `reliability.yml`, filtered by exact SHA, main branch and push event. Returned repository, source repository, SHA, branch, event, workflow name and path must agree. Only the latest matching run completing with `success` permits release. A PR run, unrelated workflow, older passing run, skipped check, failure or cancellation cannot approve production.

The gate polls every 60 seconds for at most 20 minutes, with a 10-second request timeout and at most three consecutive transient API failures. It makes at most 20 API requests per deployment. Access errors and unknown rate-limit reset windows fail closed; a documented reset may be honored within the existing deadline, at most twice. The optional `ICASH_RELEASE_GITHUB_TOKEN` supplies repository-read authentication. Missing runs, malformed responses, exhausted retry limits and timeouts still block release.

Railway's pre-deploy timeout must exceed the script's 20-minute bound. Production uses 1,500 seconds (25 minutes). The former 900-second host timeout could terminate a valid deployment while the script was still waiting for GitHub to finalize a successful run; it was corrected on October 30, 2026. The timeout change does not bypass or change any required check.

Local builds, GitHub Actions builds and Vercel previews do not wait for production checks. In particular, `build:verified` must not call the production gate unconditionally: the reliability workflow would wait for itself. Its gate tests use mocked network and time; they do not poll GitHub or call paid providers.

This is a deployment check, not GitHub branch protection. A repository administrator could remove it or override host settings, and promotion of a previously built preview may bypass a production build. Keep production releases on the Git-triggered main build path. Repository rules requiring the Reliability checks job remain a separate administrative control.

If checks fail, fix the failure and release the corrected main commit. If the API was temporarily unavailable or CI took longer than the bound, retry deployment after the same commit's main push checks pass. A rollback can use a previously successful production deployment; it does not require sending customer messages or running paid simulations. Never describe a rollback as verified until the restored deployment and public health have been checked.

## Independent production health

`.github/workflows/production-health.yml` runs a read-only public health probe every five minutes and supports manual dispatch on main. It checks HTTP 200, the exact healthy schema, database/authentication/workflow results, and a fresh server timestamp. It allows three 10-second requests separated by 10 seconds and has a two-minute job timeout. It does not invoke recoveries, customer messaging, paid providers, or issue creation.

Failed runs surface in GitHub Actions and can notify recipients according to their GitHub notification preferences. Owner notification delivery is not verified by this workflow. GitHub scheduling can be delayed, and public-repository schedules may be disabled by GitHub after extended inactivity; this is complementary monitoring, not a guaranteed paging service. The health endpoint reports the existing application/database/authentication/workflow checks, not every external provider or user task.

## References

- [GitHub workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow): workflow filename, `head_sha`, `branch`, `event`, run identity/status fields and unauthenticated public access.
- [Railway variables](https://docs.railway.com/variables/reference): `RAILWAY_ENVIRONMENT_NAME` and GitHub-triggered `RAILWAY_GIT_*` metadata.
- [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables): production and Git source metadata. System environment variables must stay enabled.
- [GitHub API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) and [scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule): public request budget and scheduling limitations.

Run the offline checks with `node tests/production-release-gate.test.mjs` and `node tests/production-health.test.mjs`.
