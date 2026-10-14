import {pathToFileURL} from 'node:url';

export const PRODUCTION_HEALTH_URL = 'https://www.geticashx.com/api/health';

export function healthyProductionResponse(status, value, now = Date.now()) {
  const checkedAt = typeof value?.checkedAt === 'string' ? Date.parse(value.checkedAt) : NaN;
  return status === 200 && value?.status === 'ok' && Number.isFinite(checkedAt) &&
    now - checkedAt <= 60_000 && checkedAt - now <= 30_000 &&
    ['database', 'authentication', 'workflows'].every(key => value?.checks?.[key] === 'ok');
}

/** Only the public, read-only health probe; no recovery or customer operations. */
export async function checkProductionHealth({fetchImpl = globalThis.fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log} = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(PRODUCTION_HEALTH_URL, {
        method: 'GET', redirect: 'error', cache: 'no-store',
        headers: {Accept: 'application/json', 'Cache-Control': 'no-cache', 'User-Agent': 'icash-production-health'},
        signal: AbortSignal.timeout(10_000),
      });
      const value = await response.json();
      if (healthyProductionResponse(response.status, value, now())) {
        log('Production health passed: application, database, authentication and workflow freshness.');
        return;
      }
    } catch { /* Retry transient network or malformed response failures without logging response data. */ }
    log(`Production health unavailable or degraded (${attempt}/3).`);
    if (attempt < 3) await sleep(10_000);
  }
  throw new Error('Production health failed after three bounded read-only probes. Inspect the service and incident dashboards.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkProductionHealth().catch(error => {console.error(error.message); process.exitCode = 1;});
}
