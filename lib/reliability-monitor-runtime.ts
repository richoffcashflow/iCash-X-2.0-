/** Only the reviewed companion service may observe/send production incidents
 * outside Vercel. Preview and arbitrary Railway services remain excluded. */
export function externalReliabilityRuntime(env:Record<string,string|undefined>){
 return env.ICASH_EXTERNAL_MONITOR_ENABLED==='true'&&!env.VERCEL_ENV
  &&env.RAILWAY_PROJECT_ID==='87d752fb-5988-452f-bf6c-1b92c3d3ff96'
  &&env.RAILWAY_ENVIRONMENT_ID==='e87ae75d-a7e3-4749-9940-75a0e6619809'
  &&env.RAILWAY_ENVIRONMENT_NAME==='production'&&env.RAILWAY_SERVICE_NAME==='reliability-monitor'
  &&env.RAILWAY_GIT_BRANCH==='main'&&env.RAILWAY_GIT_REPO_OWNER==='richoffcashflow'
  &&env.RAILWAY_GIT_REPO_NAME==='iCash-X-2.0-'&&/^[a-f0-9]{40}$/.test(env.RAILWAY_GIT_COMMIT_SHA??'')
  &&env.SUPABASE_URL==='https://ofjbbpwugyjfxbhqfguh.supabase.co';
}
