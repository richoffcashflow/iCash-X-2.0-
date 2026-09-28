import {contiguityPreflight} from '../lib/contiguity.ts';
// Read-only account check; does not send, lease numbers, or expose provider data.
let report;
try {report=await contiguityPreflight(process.env.CONTIGUITY_API_KEY??'');}
catch(e){const s=String(e?.message??'');report={authenticated:null,status:/^CONTIGUITY_[A-Z0-9_]+$/.test(s)?s:'CONTIGUITY_CHECK_FAILED',messagingEnabled:false};}
console.log(JSON.stringify(report));
if(process.argv.includes('--preview-report')&&process.env.VERCEL_ENV==='preview'){
 const {writeFile,mkdir}=await import('node:fs/promises');await mkdir('public',{recursive:true});
 await writeFile('public/contiguity-verification.json',JSON.stringify({...report,checkedAt:new Date().toISOString()}));
}
