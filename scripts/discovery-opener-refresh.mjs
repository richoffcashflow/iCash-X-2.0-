#!/usr/bin/env node
// Explicit production operation, never a test/build/maintenance hook. An operator
// must separately activate the exact release and review the exact original draft.
import {execFileSync} from 'node:child_process';
import {processDiscoveryOpenerRefresh} from '../lib/discovery-opener-refresh.ts';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
 console.log('Usage: node --experimental-strip-types scripts/discovery-opener-refresh.mjs --renewal UUID --expected-release SHA40 --allow-provider-work\nRuns at most one admitted request for one reviewed renewal. Does not review, activate, apply, issue tickets or send SMS. Requires trusted SUPABASE_URL, SUPABASE_SECRET_KEY and DEALMACHINE_API_KEY environment. Never use for development or paid verification.');
 process.exit(0);
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if(args.length!==5||args[0]!=='--renewal'||!uuid.test(args[1])||args[2]!=='--expected-release'||!/^[a-f0-9]{40}$/.test(args[3])||args[4]!=='--allow-provider-work'){
 console.error('Explicit renewal, exact release and provider-work flag required; use --help.');process.exit(2);
}
try{
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:new URL('..',import.meta.url)}).trim();
 const dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8',cwd:new URL('..',import.meta.url)}).trim();
 if(head!==args[3]||dirty)throw Error('Release mismatch');
 const {db}=await import('../lib/stripe-test.ts');
 if(await db('rpc/icash_discovery_opener_refresh_release','POST',{p_release:head})!==true)throw Error('Release inactive');
 const result=await processDiscoveryOpenerRefresh(db,process.env.DEALMACHINE_API_KEY,args[1]);
 console.log(JSON.stringify({status:result.status}));
}catch{
 // Never expose response bodies, addresses, IDs, raw SQL or credentials.
 console.error('Renewal operation held or unavailable. Inspect private original receipts; do not repeat unknown provider work.');process.exitCode=1;
}
