import {pathToFileURL} from 'node:url';

export const RELEASE_REPOSITORY = 'richoffcashflow/iCash-X-2.0-';
export const RELEASE_BRANCH = 'main';
export const RELEASE_WORKFLOW = '.github/workflows/reliability.yml';
const WORKFLOW_NAME = 'Reliability checks';
const SHA = /^[a-f0-9]{40}$/i;
const pendingStatuses = new Set(['queued', 'requested', 'waiting', 'pending', 'in_progress']);
class GitHubAccessError extends Error {}
class GitHubRateLimit extends Error {constructor(delayMs){super('GitHub rate limit');this.delayMs=delayMs;}}

/** Honor the server reset without retrying a denied request in a tight loop. */
function rateLimitDelay(response,wallNow){
 const get=name=>response.headers?.get?.(name);
 const retry=get('retry-after'),reset=get('x-ratelimit-reset');
 const delays=[];
 if(retry&&/^\d+$/.test(retry))delays.push(Number(retry)*1000);
 if(reset&&/^\d+$/.test(reset)&&get('x-ratelimit-remaining')==='0')delays.push(Number(reset)*1000-wallNow()+1000);
 return delays.length?Math.max(60_000,...delays):null;
}

/** Deployment metadata comes from the host, never a fallback to another commit. */
export function productionReleaseTarget(env = process.env, args = []) {
  if (args.some(arg => arg !== '--railway') || args.length > 1) throw new Error('Unknown release gate argument.');
  const railway = args.includes('--railway') || env.RAILWAY_ENVIRONMENT_NAME === 'production';
  const vercel = env.VERCEL === '1' && env.VERCEL_ENV === 'production';
  if (!railway && !vercel) return null;
  if (railway && vercel) throw new Error('Ambiguous production deployment host.');
  if (railway && env.RAILWAY_ENVIRONMENT_NAME !== 'production') throw new Error('Railway release gate requires the production environment.');
  const sha = railway ? env.RAILWAY_GIT_COMMIT_SHA : env.VERCEL_GIT_COMMIT_SHA;
  const branch = railway ? env.RAILWAY_GIT_BRANCH : env.VERCEL_GIT_COMMIT_REF;
  const owner = railway ? env.RAILWAY_GIT_REPO_OWNER : env.VERCEL_GIT_REPO_OWNER;
  const repo = railway ? env.RAILWAY_GIT_REPO_NAME : env.VERCEL_GIT_REPO_SLUG;
  if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error('Production release requires a full Git commit SHA.');
  if (branch !== RELEASE_BRANCH) throw new Error('Production release must originate from main.');
  if (`${owner}/${repo}`.toLowerCase() !== RELEASE_REPOSITORY.toLowerCase()) throw new Error('Production release repository does not match.');
  if (!railway && env.VERCEL_GIT_PROVIDER !== 'github') throw new Error('Production release requires GitHub deployment metadata.');
  return {host: railway ? 'railway' : 'vercel', sha: sha.toLowerCase()};
}

export function workflowRunsUrl(sha) {
  if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error('Invalid release commit SHA.');
  const url = new URL(`https://api.github.com/repos/${RELEASE_REPOSITORY}/actions/workflows/reliability.yml/runs`);
  url.search = new URLSearchParams({branch: RELEASE_BRANCH, event: 'push', head_sha: sha.toLowerCase(), per_page: '100'}).toString();
  return url.toString();
}

/** Check returned identity as well as server-side filters; never accept a PR run. */
export function inspectWorkflowRuns(payload, sha) {
  workflowRunsUrl(sha);
  if (!payload || !Number.isSafeInteger(payload.total_count) || payload.total_count < 0 || !Array.isArray(payload.workflow_runs)) {
    throw new Error('GitHub returned an invalid workflow response.');
  }
  const runs = payload.workflow_runs;
  if (payload.total_count !== runs.length || runs.length > 100) throw new Error('GitHub workflow response is incomplete.');
  for (const run of runs) {
    const paths = [RELEASE_WORKFLOW, `${RELEASE_WORKFLOW}@main`, `${RELEASE_WORKFLOW}@refs/heads/main`];
    if (!run || !Number.isSafeInteger(run.id) || run.id <= 0 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 ||
        run.head_sha?.toLowerCase() !== sha.toLowerCase() || run.head_branch !== RELEASE_BRANCH || run.event !== 'push' ||
        run.name !== WORKFLOW_NAME || !paths.includes(run.path) ||
        run.repository?.full_name?.toLowerCase() !== RELEASE_REPOSITORY.toLowerCase() ||
        run.head_repository?.full_name?.toLowerCase() !== RELEASE_REPOSITORY.toLowerCase()) {
      throw new Error('GitHub workflow identity does not match this production release.');
    }
  }
  // An older successful run cannot override a newer failed or pending run.
  const latest = [...runs].sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
  if (!latest) return {state: 'waiting', reason: 'Waiting for the main push workflow to appear.'};
  if (latest.status === 'completed') {
    if (latest.conclusion !== 'success') throw new Error(`Reliability checks run ${latest.id} completed with ${latest.conclusion || 'no conclusion'}.`);
    return {state: 'passed', runId: latest.id, attempt: latest.run_attempt};
  }
  if (!pendingStatuses.has(latest.status) || latest.conclusion != null) throw new Error('GitHub returned an unexpected workflow status.');
  return {state: 'waiting', reason: `Reliability checks run ${latest.id} is ${latest.status}.`};
}

/** Read-only GitHub request. A failed/unknown check never releases production. */
export async function waitForReliabilityChecks(sha, {
  fetchImpl = globalThis.fetch,
  now = () => performance.now(),
  wallNow = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = console.log,
  maxWaitMs = 20 * 60 * 1000,
  pollMs = 60 * 1000,
  requestTimeoutMs = 10 * 1000,
  maxApiErrors = 3,
  token,
} = {}) {
  const url = workflowRunsUrl(sha);
  for (const value of [maxWaitMs, pollMs, requestTimeoutMs, maxApiErrors]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid release gate timing.');
  }
  const deadline = now() + maxWaitMs;
  if(token!==undefined&&(typeof token!=='string'||!/^[A-Za-z0-9_]{20,255}$/.test(token)))throw new Error('Invalid release verification credential.');
  let apiErrors = 0;
  let polls = 0;
  let rateLimits = 0;
  // The count also bounds work if a supplied clock stops advancing.
  const maxPolls = Math.ceil(maxWaitMs / pollMs);
  while (now() < deadline && polls++ < maxPolls) {
    let payload;
    try {
      const response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', cache: 'no-store',
        headers: {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'icash-production-release-gate',...(token?{Authorization:`Bearer ${token}`}:{})},
        signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, Math.ceil(deadline - now())))),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        const delay=[403,429].includes(response.status)?rateLimitDelay(response,wallNow):null;
        if(delay!==null&&Number.isFinite(delay)&&delay<deadline-now()&&rateLimits++<2)throw new GitHubRateLimit(delay);
        // Unknown resets and denied access remain fail-closed.
        if ([401, 403, 404, 422, 429].includes(response.status)) throw new GitHubAccessError(`GitHub API access blocked verification (HTTP ${response.status}). Retry deployment after access or rate limits recover.`);
        throw new Error(`GitHub API returned HTTP ${response.status}.`);
      }
      payload = await response.json();
      apiErrors = 0;
    } catch (error) {
      if(error instanceof GitHubRateLimit){
        log('Release verification is waiting for the GitHub rate-limit reset.');
        // Short waits let cancellation and host termination stay responsive.
        let remaining=error.delayMs;
        while(remaining>0&&now()<deadline){const wait=Math.min(60_000,remaining,deadline-now());await sleep(wait);remaining-=wait;}
        continue;
      }
      if (error instanceof GitHubAccessError) throw error;
      apiErrors += 1;
      log(`Release verification unavailable (${apiErrors}/${maxApiErrors}).`);
      if (apiErrors >= maxApiErrors) throw new Error('Cannot verify production checks after bounded GitHub API retries.', {cause: error});
    }
    if (now() >= deadline) break;
    if (payload !== undefined) {
      const result = inspectWorkflowRuns(payload, sha);
      if (result.state === 'passed') {
        log(`Production release verified: ${sha}, Reliability checks run ${result.runId}, attempt ${result.attempt}.`);
        return result;
      }
      log(result.reason);
    }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(pollMs, remaining));
  }
  throw new Error('Timed out waiting for successful Reliability checks on the exact production commit.');
}

export async function verifyProductionRelease({env = process.env, args = process.argv.slice(2), ...dependencies} = {}) {
  const target = productionReleaseTarget(env, args);
  if (!target) {
    (dependencies.log || console.log)('Production release gate skipped outside production deployment.');
    return {state: 'skipped'};
  }
  return waitForReliabilityChecks(target.sha, {token:env.ICASH_RELEASE_GITHUB_TOKEN,...dependencies});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyProductionRelease().catch(error => {
    console.error(`Production release blocked: ${error.message}`);
    process.exitCode = 1;
  });
}
