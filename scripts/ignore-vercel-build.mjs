import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
// Only known non-runtime files are skippable. Unknown files always build.
export function canSkipBuild(paths){
 return paths.length>0&&paths.every(path=>/^(docs\/|tests\/|worker\/)/.test(path)||/^(README[^/]*\.md|AGENTS\.md|LICENSE)$/.test(path));
}
export function ignoreBuild(env=process.env,git=(...args)=>execFileSync('git',args,{encoding:'utf8'})){
 const base=env.VERCEL_GIT_PREVIOUS_SHA,head=env.VERCEL_GIT_COMMIT_SHA;
 if(!/^[a-f0-9]{40}$/.test(base??'')||! /^[a-f0-9]{40}$/.test(head??''))return false;
 try{
  // Diff against the last deployed commit, never just HEAD^ (which misses batches).
  git('merge-base','--is-ancestor',base,head);
  return canSkipBuild(git('diff','--name-only','-z',base,head).split('\0').filter(Boolean));
 }catch{return false;} // Shallow history or missing comparison: build safely.
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const skip=ignoreBuild();console.log(skip?'Skipping application build: no runtime changes.':'Building application.');
 process.exit(skip?0:1); // Vercel's ignored-build convention.
}
