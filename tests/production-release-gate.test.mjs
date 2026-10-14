import assert from 'node:assert/strict';
import {inspectWorkflowRuns, productionReleaseTarget, verifyProductionRelease, waitForReliabilityChecks, workflowRunsUrl, RELEASE_REPOSITORY} from '../scripts/verify-production-release.mjs';

const sha = 'a'.repeat(40);
const vercel = {VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_COMMIT_SHA: sha, VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_REPO_OWNER: 'richoffcashflow', VERCEL_GIT_REPO_SLUG: 'iCash-X-2.0-'};
const railway = {RAILWAY_ENVIRONMENT_NAME: 'production', RAILWAY_GIT_COMMIT_SHA: sha, RAILWAY_GIT_BRANCH: 'main', RAILWAY_GIT_REPO_OWNER: 'richoffcashflow', RAILWAY_GIT_REPO_NAME: 'iCash-X-2.0-'};
const run = (overrides = {}) => ({id: 42, run_attempt: 1, name: 'Reliability checks', path: '.github/workflows/reliability.yml', head_sha: sha, head_branch: 'main', event: 'push', repository: {full_name: RELEASE_REPOSITORY}, head_repository: {full_name: RELEASE_REPOSITORY}, status: 'completed', conclusion: 'success', ...overrides});
const payload = (...runs) => ({total_count: runs.length, workflow_runs: runs});
const ok = body => ({status: 200, json: async () => body});
const quiet = () => {};

assert.deepEqual(productionReleaseTarget(vercel), {host: 'vercel', sha});
assert.deepEqual(productionReleaseTarget(railway, ['--railway']), {host: 'railway', sha});
for (const env of [{}, {CI: 'true', GITHUB_ACTIONS: 'true', NODE_ENV: 'production'}, {...vercel, VERCEL_ENV: 'preview'}, {...railway, RAILWAY_ENVIRONMENT_NAME: 'staging'}]) assert.equal(productionReleaseTarget(env), null);
for (const value of [undefined, '', 'abcd', 'a'.repeat(39), 'g'.repeat(40), `${sha}\n`]) assert.throws(() => productionReleaseTarget({...vercel, VERCEL_GIT_COMMIT_SHA: value}), /SHA/);
for (const env of [{...vercel, VERCEL_GIT_COMMIT_REF: 'feature'}, {...vercel, VERCEL_GIT_COMMIT_REF: undefined}, {...vercel, VERCEL_GIT_REPO_OWNER: 'fork'}, {...vercel, VERCEL_GIT_REPO_SLUG: undefined}, {...vercel, VERCEL_GIT_PROVIDER: 'gitlab'}, {...railway, RAILWAY_GIT_BRANCH: 'feature'}, {...railway, RAILWAY_GIT_REPO_NAME: 'other'}, {...railway, RAILWAY_GIT_COMMIT_SHA: undefined}]) assert.throws(() => productionReleaseTarget(env));
assert.throws(() => productionReleaseTarget({}, ['--railway']), /production environment/);
assert.throws(() => productionReleaseTarget({...railway, RAILWAY_ENVIRONMENT_NAME: 'staging'}, ['--railway']), /production environment/);
assert.throws(() => productionReleaseTarget(vercel, ['--skip']), /argument/);
assert.throws(() => productionReleaseTarget({...vercel, ...railway}), /Ambiguous/);
assert.equal((await verifyProductionRelease({env: {GITHUB_ACTIONS: 'true'}, args: [], fetchImpl: () => {throw new Error('CI must never wait for itself');}, log: quiet})).state, 'skipped');

const url = new URL(workflowRunsUrl(sha));
assert.equal(url.origin, 'https://api.github.com');
assert.equal(url.pathname, `/repos/${RELEASE_REPOSITORY}/actions/workflows/reliability.yml/runs`);
assert.equal(url.searchParams.get('head_sha'), sha);
assert.equal(url.searchParams.get('branch'), 'main');
assert.equal(url.searchParams.get('event'), 'push');
assert.equal(url.searchParams.get('status'), null, 'Do not hide failed or pending newer runs');
assert.equal(inspectWorkflowRuns(payload(run()), sha).state, 'passed');
assert.equal(inspectWorkflowRuns(payload(), sha).state, 'waiting');
assert.equal(inspectWorkflowRuns(payload(run({status: 'queued', conclusion: null})), sha).state, 'waiting');
for (const path of ['.github/workflows/reliability.yml@main', '.github/workflows/reliability.yml@refs/heads/main']) assert.equal(inspectWorkflowRuns(payload(run({path})), sha).state, 'passed');
for (const changes of [{head_sha: 'b'.repeat(40)}, {head_branch: 'feature'}, {event: 'pull_request'}, {event: 'workflow_dispatch'}, {name: 'Other checks'}, {path: '.github/workflows/other.yml'}, {path: '.github/workflows/reliability.yml@feature'}, {repository: {full_name: 'fork/other'}}, {head_repository: {full_name: 'fork/iCash-X-2.0-'}}, {run_attempt: 0}, {status: 'unknown'}, {status: 'in_progress', conclusion: 'success'}]) assert.throws(() => inspectWorkflowRuns(payload(run(changes)), sha));
for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', null]) assert.throws(() => inspectWorkflowRuns(payload(run({conclusion})), sha), /completed with/);
assert.throws(() => inspectWorkflowRuns({total_count: 101, workflow_runs: [run()]}, sha), /incomplete/);
assert.throws(() => inspectWorkflowRuns({workflow_runs: [run()]}, sha), /invalid/);
assert.throws(() => inspectWorkflowRuns(payload(run(), run({id: 43, conclusion: 'failure'})), sha), /failure/);
assert.equal(inspectWorkflowRuns(payload(run(), run({id: 43, status: 'in_progress', conclusion: null})), sha).state, 'waiting');

function fixture(responses, overrides = {}) {
  let clock = 0;
  const calls = [];
  const sleeps = [];
  return {
    calls, sleeps,
    options: {
      now: () => clock, sleep: async ms => {sleeps.push(ms); clock += ms;}, log: quiet,
      maxWaitMs: 90_000, pollMs: 30_000,
      fetchImpl: async (request, options) => {
        calls.push({request, options});
        const response = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (response instanceof Error) throw response;
        return response;
      }, ...overrides,
    },
  };
}
const happy = fixture([ok(payload()), ok(payload(run({status: 'in_progress', conclusion: null}))), ok(payload(run()))]);
assert.equal((await waitForReliabilityChecks(sha, happy.options)).state, 'passed');
assert.equal(happy.calls.length, 3);
assert.deepEqual(happy.sleeps, [30_000, 30_000]);
assert.equal(happy.calls[0].options.method, 'GET');
assert.equal(happy.calls[0].options.redirect, 'error');
assert.equal(happy.calls[0].options.headers.Authorization, undefined);
assert.ok(happy.calls[0].options.signal instanceof AbortSignal);
const temporary = fixture([new Error('network unavailable'), ok(payload(run()))]);
assert.equal((await waitForReliabilityChecks(sha, temporary.options)).state, 'passed');
const unavailable = fixture([{status: 503}]);
await assert.rejects(waitForReliabilityChecks(sha, unavailable.options), /bounded GitHub API retries/);
assert.equal(unavailable.calls.length, 3);
for (const status of [401, 403, 404, 429]) {
  const denied = fixture([{status}]);
  await assert.rejects(waitForReliabilityChecks(sha, denied.options), /access blocked/);
  assert.equal(denied.calls.length, 1, 'Do not retry access or rate-limit failures');
}
const neverStarts = fixture([ok(payload())], {maxWaitMs: 12 * 60_000});
await assert.rejects(waitForReliabilityChecks(sha, neverStarts.options), /Timed out/);
assert.equal(neverStarts.calls.length, 24);
assert.equal(neverStarts.sleeps.reduce((a, b) => a + b, 0), 12 * 60_000);
const failed = fixture([ok(payload(run({conclusion: 'failure'})))]);
await assert.rejects(waitForReliabilityChecks(sha, failed.options), /failure/);
assert.equal(failed.calls.length, 1);
assert.equal(failed.sleeps.length, 0);
const malformed = fixture([ok({total_count: 1})]);
await assert.rejects(waitForReliabilityChecks(sha, malformed.options), /invalid/);
assert.equal(malformed.calls.length, 1);
const timeout = fixture([], {requestTimeoutMs: 1, maxApiErrors: 1, fetchImpl: async (_url, {signal}) => {await new Promise(resolve => setTimeout(resolve, 5)); signal.throwIfAborted();}});
await assert.rejects(waitForReliabilityChecks(sha, timeout.options), /bounded GitHub API retries/);
console.log('production-release-gate: exact commit, host identity, failed checks, bounded retries and CI isolation passed');
