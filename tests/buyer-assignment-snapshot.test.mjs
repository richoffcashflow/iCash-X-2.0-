import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadService,databaseAdapter} from './helpers/simulated-journey-services.mjs';
import {signingTermsHash} from '../lib/signing-policy.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
const read=p=>readFileSync(p,'utf8');
const fn=(p,name)=>{const text=read(p),start=text.indexOf('create function public.'+name+'(');assert(start>=0);const tag=text.slice(start).match(/\bas (\$[A-Za-z_]*\$)/i)[1],body=text.indexOf(tag,start);return text.slice(start,text.indexOf(tag+';',body+tag.length)+tag.length+1);};
const pg=await PGlite.create(),q=(s,p=[])=>pg.query(s,p),one=async(s,p=[])=>Object.values((await q(s,p)).rows[0])[0];
const id='00000000-0000-4000-8000-000000000006',account='00000000-0000-4000-8000-000000000002';
const patch=read('config/buyer-assignment-terms-snapshot.sql');
const migrations=readdirSync('supabase/migrations').filter(p=>p.endsWith('_buyer_assignment_terms_snapshot.sql'));
assert.equal(migrations.length,1);assert.equal(patch,read('supabase/migrations/'+migrations[0]));
globalThis.fetch=async()=>{throw Error('NETWORK DISABLED');};
try{
 await pg.exec(read('tests/helpers/buyer-assignment-snapshot-fixture.sql'));
 await pg.exec(fn('config/turnkey-deal-journey.sql','icash_journey_allowed'));
 await pg.exec(read('tests/fixtures/buyer-assignment-claim-before-snapshot.sql'));
 await pg.exec(fn('config/closing-completion.sql','icash_claim_journey_assignment'));
 await pg.exec("revoke all on function icash_claim_journey_assignment_before_completion(uuid),icash_claim_journey_assignment(uuid) from public,anon,authenticated;grant execute on function icash_claim_journey_assignment_before_completion(uuid),icash_claim_journey_assignment(uuid) to service_role;");
 assert.equal(await one("select md5(pg_get_functiondef('icash_claim_journey_assignment_before_completion(uuid)'::regprocedure))"),'4dcbb00b25643248c6cffe3648dc5e48');
 await pg.exec('begin');const before=await one('select icash_claim_journey_assignment($1)',[id]);assert(!Object.hasOwn(before,'expectedTerms'),'Reproduce original missing snapshot');await pg.exec('rollback');
 await pg.exec(patch);
 const claim=()=>one('select icash_claim_journey_assignment($1)',[id]);
 let cases=0;
 for(const change of [
  "update icash_accounts set bot_paused=true",
  "update icash_screening_jobs set state='archived'",
  "update icash_deal_files set stage='cancelled'",
  "update icash_deal_files set stage='closed'",
  "update icash_deal_files set buyer_hold=true",
  "update icash_deal_files set terms=terms||'{\"practice\":true}'",
  "insert into icash_property_controls select id,'prop_123',true from icash_accounts",
  "insert into icash_handoffs select account_id,id,'open' from icash_screening_jobs",
  "update icash_signing_envelopes set state='awaiting_counterparty'",
  "update icash_signing_envelopes set test_mode=true",
  "update icash_text_threads set paused=true",
  "update icash_text_threads set manual_only=true",
  "update icash_text_threads set retired_at=now()",
  "update icash_text_threads set contact_current=false",
  "insert into icash_text_suppressions select recipient from icash_text_threads",
  "update icash_deal_journeys set expires_at=now()-interval '1 minute'",
  "update icash_deal_journeys set state='sending'",
  "update icash_deal_journeys set buyer_details=null",
  "update auth.users set email_confirmed_at=null",
  "update icash_deal_files set terms=terms||'{\"priceCents\":9300000}'",
  "update icash_deal_files set terms=terms||'{\"assignmentFeeCents\":1100000}'",
  "update icash_deal_files set terms=terms||'{\"assignmentDepositCents\":300000}'",
  "insert into icash_journey_blockers select id,'open','human' from icash_deal_journeys",
  "insert into icash_signing_envelopes(account_id,deal_id,kind,state) select account_id,deal_id,'assignment','needs_review' from icash_deal_journeys",
 ]){
  await pg.exec('begin');await pg.exec(change);assert.equal(await claim(),null,change);await pg.exec('rollback');cases++;
 }
 const adapter=databaseAdapter(pg);
 // The actual signing entry point must reject every post-claim document edit
 // before reading a template, creating an envelope or contacting a provider.
 process.env.DOCUSEAL_API_KEY='offline-fixture';
 const db=async(path,method,body)=>path.startsWith('icash_customer_identities')?[{principal:'Fixture Principal'}]:adapter.db(path,method,body);
 const {sendForSignatures}=await loadService('lib/signing-service.ts',{db,dealTermsSchema,signingTermsHash});
 for(const change of [{priceCents:9300000},{assignmentFeeCents:1100000},{assignmentDepositCents:300000},{closingDate:'2099-12-05'},{assignee:'Someone Else'},{inspectionDays:4}]){
  await pg.exec('begin');const c=await claim();assert.deepEqual(c.expectedTerms,await one('select terms from icash_deal_files'));assert.equal(c.expectedTerms.assignee,'Fixture Buyer LLC');
  await q('update icash_deal_files set terms=terms||$1::jsonb',[JSON.stringify(change)]);
  await assert.rejects(sendForSignatures({...c,kind:'assignment',signers:[{name:c.signerName,email:c.email,phone:c.phone}]}),/confirmed terms changed/);
  assert.equal(await claim(),null,'Consumed claim cannot replay after an edit');await pg.exec('rollback');cases++;
 }
 const c=await claim();assert.equal(c.expectedTerms.priceCents,9200000);assert.equal(c.expectedTerms.assignmentFeeCents,1000000);assert.equal(await claim(),null);
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_claim_journey_assignment_before_completion(uuid)','EXECUTE')",[role]),false);
 const hash=await one("select md5(pg_get_functiondef('icash_claim_journey_assignment_before_completion(uuid)'::regprocedure))");
 await assert.rejects(pg.exec(patch),/prerequisite changed/);await pg.exec('rollback');assert.equal(await one("select md5(pg_get_functiondef('icash_claim_journey_assignment_before_completion(uuid)'::regprocedure))"),hash);
 console.log(`PASS ${cases} actual buyer-claim/signing cases, source reproduction, one-use terms snapshot, ACL preservation and guarded repeat refusal. New hash ${hash}. Offline only.`);
}finally{await pg.close();}
