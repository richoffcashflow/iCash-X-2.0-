// SIMULATION ONLY. In-memory PostgreSQL; never opens a network or production connection.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export async function createJourneyDb(modulePath,suppliedPg=null){
 const notices=[];let pg=suppliedPg;
 if(!pg){
  assert(modulePath&&isAbsolute(modulePath),'Supply an existing official PGlite module path');
  const {PGlite}=await import(pathToFileURL(modulePath).href);
  pg=await PGlite.create({onNotice:n=>notices.push(n.message)});
 }
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create schema extensions;create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;`);
 // This fixture reconstructs the original provider journey. Later migrations
 // depend on intervening config releases and must not run before those releases.
 // Current inbound distribution/response migrations have their own SQL fixtures.
 const files=readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')&&x<'20261003000000').sort().map(x=>'supabase/migrations/'+x);
 // Explicit dependency/override order. Configs are the production SQL, not reconstructed functions.
 files.push(...[
  'assignment-title-ordering','live-dispatch','setup-voice-dispatch','fulfillment-completion','buyer-discovery','buyer-search-config-integrity','buyer-voice',
  'text-messaging','text-stop-voice','inventory-allocation','account-margin',
  'estimated-operation-settlement','communication-fractional-billing','customer-funded-margins','scoped-spend-activation',
  'estimated-settlement-fairness','dealmachine-cost-baseline','bot-setup-funnel','bot-setup-session-isolation','market-shortlist',
  'funded-account-provisioning','funded-provisioning-trigger','funded-voice-provisioning','market-contract-coverage','standard-contract-routing','research-contract-separation','requested-property-zip-resolution',
  'daytime-pacing','inbound-voice','voice-launch-hardening','voice-sms-context','voice-usage-settlement','voice-pending-estimate-isolation',
  'reviewed-action-authority','buyer-qualification','title-requests','title-directory','title-inbound','closing-coordination','closing-confirmations','title-tasks','title-followup','manual-deal-email','requested-buyer-package-email','buyer-title-ordering',
 ].map(x=>'config/'+x+'.sql'));
 try{for(const file of files){try{await pg.exec(read(file));}catch(e){throw new Error(`Loading ${file}: ${e.message}`,{cause:e});}}}
 catch(e){await pg.close();throw e;}
 return {pg,notices,files};
}
