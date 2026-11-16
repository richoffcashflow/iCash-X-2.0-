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
const limited=fixture([{status:403,headers:new Headers({'x-ratelimit-remaining':'0','x-ratelimit-reset':'60'})},ok(payload(run()))],{wallNow:()=>0});
assert.equal((await waitForReliabilityChecks(sha,limited.options)).state,'passed');
assert.deepEqual(limited.sleeps,[60000,1000],'Retry only after the reset, in bounded waits');
const tooLate=fixture([{status:429,headers:new Headers({'retry-after':'3600'})}]);
await assert.rejects(waitForReliabilityChecks(sha,tooLate.options),/access blocked/);assert.equal(tooLate.calls.length,1);

// HTTP dates use the same bounded wait and exact-release proof as numeric timing.
const wallTime = Date.UTC(2026, 10, 15, 12);
const rateResponse = (retry, status = 429, headers = {}) => new Response(null, {status, headers: {'retry-after': retry, ...headers}});
for (const retry of ['Sun, 15 Nov 2026 12:01:05 GMT', 'Sunday, 15-Nov-26 12:01:05 GMT', 'Sun Nov 15 12:01:05 2026']) {
  for (const status of [403, 429]) {
    const dated = fixture([rateResponse(retry, status), ok(payload(run()))], {wallNow: () => wallTime});
    assert.equal((await waitForReliabilityChecks(sha, dated.options)).state, 'passed');
    assert.deepEqual(dated.sleeps, [60_000, 5_000]);
    assert.equal(dated.calls.length, 2);
    assert.equal(dated.calls[1].request, dated.calls[0].request);
  }
}
const singleDay = fixture([rateResponse('Sun Nov  1 12:01:05 2026'), ok(payload(run()))], {wallNow: () => Date.UTC(2026, 10, 1, 12)});
await waitForReliabilityChecks(sha, singleDay.options);
assert.deepEqual(singleDay.sleeps, [60_000, 5_000]);
const century = fixture([rateResponse('Friday, 01-Jan-00 00:00:05 GMT'), ok(payload(run()))], {wallNow: () => Date.UTC(2099, 11, 31, 23, 59)});
await waitForReliabilityChecks(sha, century.options);
assert.deepEqual(century.sleeps, [60_000, 5_000], 'Obsolete two-digit years also work across a century boundary');
for (const [retry, reason] of [
  ['not-a-date-private-marker', /invalid Retry-After timing/],
  ['2026-11-15T12:01:05Z', /invalid Retry-After timing/],
  ['Sun, 15 Nov 2026 12:01:05 UTC', /invalid Retry-After timing/],
  ['Mon, 15 Nov 2026 12:01:05 GMT', /invalid Retry-After timing/],
  ['Sun, 15 Xxx 2026 12:01:05 GMT', /invalid Retry-After timing/],
  ['Tue, 31 Nov 2026 12:01:05 GMT', /invalid Retry-After timing/],
  ['Sun, 15 Nov 2026 24:01:05 GMT', /invalid Retry-After timing/],
  ['Sun, 15 Nov 2026 12:60:05 GMT', /invalid Retry-After timing/],
  ['Sun, 15 Nov 2026 12:01:60 GMT', /invalid Retry-After timing/],
  ['Sun, 15 Nov 2026 12:01:05 GMT, Sun, 15 Nov 2026 12:01:06 GMT', /invalid Retry-After timing/],
  ['x'.repeat(1000), /invalid Retry-After timing/],
  ['Sun, 15 Nov 2026 11:59:59 GMT', /date has elapsed/],
  ['Sun, 15 Nov 2026 12:00:00 GMT', /date has elapsed/],
  ['Monday, 15-Nov-76 12:01:05 GMT', /date has elapsed/],
  ['Sun, 15 Nov 2026 12:01:30 GMT', /exceeds remaining verification window/],
  ['Sun, 15 Nov 2026 13:00:00 GMT', /exceeds remaining verification window/],
]) {
  const denied = fixture([rateResponse(retry)], {wallNow: () => wallTime});
  await assert.rejects(waitForReliabilityChecks(sha, denied.options), error => {
    assert.match(error.message, reason);
    assert.equal(error.message.includes(retry), false, 'Diagnostics never echo untrusted header values');
    return true;
  });
  assert.equal(denied.calls.length, 1);
  assert.deepEqual(denied.sleeps, []);
}
for (const [retry, waits] of [['0', [60_000]], ['0001', [60_000]], ['61', [60_000, 1_000]]]) {
  const numeric = fixture([rateResponse(retry), ok(payload(run()))]);
  await waitForReliabilityChecks(sha, numeric.options);
  assert.deepEqual(numeric.sleeps, waits, 'Existing nonnegative numeric handling keeps the minimum minute');
}
const bothTiming = fixture([rateResponse('Sun, 15 Nov 2026 12:01:05 GMT', 403, {
  'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(wallTime / 1000 + 70),
}), ok(payload(run()))], {wallNow: () => wallTime});
await waitForReliabilityChecks(sha, bothTiming.options);
assert.deepEqual(bothTiming.sleeps, [60_000, 11_000], 'Never retry before either authoritative delay');
const validReset = fixture([rateResponse('invalid-date', 403, {
  'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(wallTime / 1000 + 60),
}), ok(payload(run()))], {wallNow: () => wallTime});
await waitForReliabilityChecks(sha, validReset.options);
assert.deepEqual(validReset.sleeps, [60_000, 1_000], 'A separately valid reset retains its existing authority');
const ambiguous = fixture([{status: 403, headers: new Headers({'x-ratelimit-remaining': '1', 'x-ratelimit-reset': String(wallTime / 1000 + 60)})}], {wallNow: () => wallTime});
await assert.rejects(waitForReliabilityChecks(sha, ambiguous.options), /no usable retry timing/);
assert.equal(ambiguous.calls.length, 1);
const capped = fixture([rateResponse('60')], {maxWaitMs: 20 * 60_000});
await assert.rejects(waitForReliabilityChecks(sha, capped.options), /two rate-limit waits already used/);
assert.equal(capped.calls.length, 3);
assert.deepEqual(capped.sleeps, [60_000, 60_000]);
const deadline = fixture([rateResponse('Sun, 15 Nov 2026 12:20:00 GMT')], {maxWaitMs: 20 * 60_000, wallNow: () => wallTime});
await assert.rejects(waitForReliabilityChecks(sha, deadline.options), /exceeds remaining verification window/);
assert.equal(deadline.calls.length, 1);
for (const changes of [{conclusion: 'failure'}, {head_sha: 'b'.repeat(40)}, {event: 'pull_request'}]) {
  const invalidProof = fixture([rateResponse('Sun, 15 Nov 2026 12:01:05 GMT'), ok(payload(run(changes)))], {wallNow: () => wallTime});
  await assert.rejects(waitForReliabilityChecks(sha, invalidProof.options), /failure|identity/);
  assert.equal(invalidProof.calls.length, 2, 'Waiting cannot authorize failed or unrelated checks');
}

// Real Response/ReadableStream cleanup can remain pending, reject or throw. None
// may suppress a known status, delay the gate, or cause an unhandled rejection.
async function promptly(promise) {
  let timer;
  try {return await Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('Response cleanup stalled release verification')), 1000);})]);}
  finally {clearTimeout(timer);}
}
const cleanupErrors = [];
const onUnhandled = error => cleanupErrors.push(error);
process.on('unhandledRejection', onUnhandled);
try {
  for (const cleanup of ['pending', 'reject', 'throw']) {
    for (const status of [403, 429, 503]) {
      let cancellations = 0;
      const cancel = () => {
        cancellations += 1;
        if (cleanup === 'throw') throw new Error('private cleanup failure');
        if (cleanup === 'reject') return Promise.reject(new Error('private cleanup failure'));
        return new Promise(() => {});
      };
      const response = new Response(new ReadableStream({cancel}), {status, headers: status === 429 ? {'retry-after': '60'} : {}});
      if (cleanup === 'throw') response.body.cancel = cancel;
      const stalled = fixture([response, new Response(JSON.stringify(payload(run())), {status: 200})]);
      if (status === 403) {
        await assert.rejects(promptly(waitForReliabilityChecks(sha, stalled.options)), /HTTP 403; no usable retry timing/);
        assert.equal(stalled.calls.length, 1);
        assert.deepEqual(stalled.sleeps, []);
      } else {
        assert.equal((await promptly(waitForReliabilityChecks(sha, stalled.options))).state, 'passed');
        assert.equal(stalled.calls.length, 2);
        assert.deepEqual(stalled.sleeps, [status === 429 ? 60_000 : 30_000]);
      }
      assert.equal(cancellations, 1);
    }
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(cleanupErrors, []);
} finally {process.off('unhandledRejection', onUnhandled);}

const authenticated=fixture([ok(payload(run()))],{token:'synthetic_readonly_token_for_fixture'});
await waitForReliabilityChecks(sha,authenticated.options);
assert.equal(authenticated.calls[0].options.headers.Authorization,'Bearer synthetic_readonly_token_for_fixture');
await assert.rejects(waitForReliabilityChecks(sha,{...authenticated.options,token:'bad\ncredential'}),/credential/);
const timeout = fixture([], {requestTimeoutMs: 1, maxApiErrors: 1, fetchImpl: async (_url, {signal}) => {await new Promise(resolve => setTimeout(resolve, 5)); signal.throwIfAborted();}});
await assert.rejects(waitForReliabilityChecks(sha, timeout.options), /bounded GitHub API retries/);
console.log('production-release-gate: exact commit, host identity, failed checks, bounded retries and CI isolation passed');
