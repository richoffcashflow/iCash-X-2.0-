import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {verifyActiveExportOnce} from './verify-dealmachine-active-export.mjs';
import {inspectSavedActiveExport} from './dealmachine-export-artifact.mjs';

// October 27: explicit approval for the prepared one-owner/one-credit check.
// This narrow exception does not enable any other paid development tests.
export async function runApprovedActiveExport(env=process.env,loadDb=async()=> (await import('../lib/stripe-test.ts')).db){
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='codex/dealmachine-active-phone-contract-20261027')return {status:'not_requested'};
 if(env.VERCEL_GIT_REPO_OWNER!=='richoffcashflow'||env.VERCEL_GIT_REPO_SLUG!=='iCash-X-2.0-'
  ||env.SUPABASE_URL?.replace(/\/$/,'')!=='https://ofjbbpwugyjfxbhqfguh.supabase.co'||!env.SUPABASE_SECRET_KEY)return {status:'configuration_unavailable'};
 const db=await loadDb();
 const verification=await verifyActiveExportOnce({db,env});
 let artifact={status:'not_requested'};
 if(['response_saved','already_consumed_or_unapproved'].includes(verification.status)){
  try{artifact=await inspectSavedActiveExport({db});}catch(error){artifact={status:'unavailable',reason:/^EXPORT_[A-Z_]+$/.test(error?.message??'')?error.message:'EXPORT_READ_UNAVAILABLE'};}
 }
 return {verification,artifact};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{console.log('Approved DealMachine activity verification: '+JSON.stringify(await runApprovedActiveExport()));}
 catch{console.log('Approved DealMachine activity verification: held; no automatic retry.');}
}
