// Run only in a trusted server environment with DEALMACHINE_API_KEY injected.
// Prints aggregate usage/count/estimate only. Never prints credentials or records.
import { createDealMachinePreflight } from '../lib/dealmachine-preflight.ts';
try {
 const zip=process.argv[2];
 if(zip && !/^\d{5}$/.test(zip)) throw new Error('Use a five-digit ZIP code');
 const client=createDealMachinePreflight(process.env.DEALMACHINE_API_KEY??'');
 const usage=await client.usage();
 const result={usage};
 if(zip){result.count=await client.countProperties(zip);result.estimate=await client.estimateProperties({zip});}
 console.log(JSON.stringify(result,null,2));
} catch(e) {console.error(e instanceof Error?e.message:'Preflight failed');process.exitCode=1;}
