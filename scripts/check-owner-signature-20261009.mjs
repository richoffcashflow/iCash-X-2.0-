// Short-lived, read-only verification of the owner's reported signing failure.
// No signing URLs, document contents, credentials or contact details are logged.
import {normalizeDocuseal} from '../lib/docuseal-policy.ts';
import {verifiedSigningStatus} from '../lib/signing-policy.ts';
if(process.env.VERCEL_ENV==='production'&&process.env.VERCEL_GIT_COMMIT_REF==='main'&&Date.now()<Date.parse('2026-10-10T00:00:00Z')){
 try{
  const id='403e9d93-490e-452c-b528-51106854cf3b',account='48dfb798-8c1a-404f-88c0-c396cc067062';
  const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/icash_signing_envelopes?id=eq.${id}&account_id=eq.${account}&select=id,provider_id,terms_hash,recipients,test_mode`,{headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('DATABASE_READ_UNAVAILABLE');const [e]=await r.json();
  if(e?.provider_id!=='12088037'||e.test_mode)throw Error('EXPECTED_ENVELOPE_REQUIRED');
  const response=await fetch('https://api.docuseal.com/submissions/12088037',{headers:{'X-Auth-Token':process.env.DOCUSEAL_API_KEY},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('PROVIDER_READ_UNAVAILABLE');const raw=await response.json();
  const checks=e.recipients.map((r,i)=>{const s=raw.submitters?.find(s=>s.external_id===`${e.id}:${r.id}`);return {party:i+1,found:!!s,submissionMatches:s?.submission_id===raw.id,hashMatches:s?.metadata?.terms_hash===e.terms_hash,positionMatches:raw.submitters?.[i]?.external_id===`${e.id}:${r.id}`,status:s?.status};});
  console.log('Owner signing bindings:',JSON.stringify(checks));
  const normalized=normalizeDocuseal(raw,e);console.log('Owner verified signature status:',verifiedSigningStatus(normalized,{providerId:e.provider_id,id:e.id,termsHash:e.terms_hash,testMode:e.test_mode,recipients:e.recipients}));
 }catch(e){console.log('Owner signature verification:',e.message);}
}
