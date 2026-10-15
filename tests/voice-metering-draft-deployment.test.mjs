import assert from 'node:assert/strict';
import {ignoreBuild,undeployedMeteringDraft} from '../scripts/ignore-vercel-build.mjs';
import {readFileSync} from 'node:fs';
const noGit=()=>{throw Error('Draft must skip even before a previous deploy exists');};
assert.equal(ignoreBuild({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:undeployedMeteringDraft},noGit),true);
for(const branch of ['main','feature/other','codex/draft-live-voice-metering-20261015-other',undefined]){
 assert.equal(ignoreBuild({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:branch},noGit),false,'Other branches keep existing fail-safe build behavior');
}
const env={VERCEL_GIT_PREVIOUS_SHA:'a'.repeat(40),VERCEL_GIT_COMMIT_SHA:'b'.repeat(40)};
assert.equal(ignoreBuild({...env,VERCEL_GIT_COMMIT_REF:'main'},(...args)=>args[0]==='diff'?'lib/runtime.ts\0':''),false);
assert.equal(ignoreBuild({...env,VERCEL_GIT_COMMIT_REF:'main'},(...args)=>args[0]==='diff'?'docs/readme.md\0':''),true,'Main retains existing documentation-only policy');
const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
assert.equal(config.ignoreCommand,'node scripts/ignore-vercel-build.mjs');
console.log('PASS exact draft branch skips automatic Vercel previews; main and other branch behavior unchanged. No deployment or project setting changed.');
