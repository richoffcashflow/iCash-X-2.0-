import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
// Install the exact pre-release readers, without unrelated write-path fixtures.
// The report and evidence functions run against real synthetic rows below;
// unchanged learning writes remain covered by their dedicated suites.
export async function installInterestEvidence(db){
 await db.exec(`create schema icash_ranker_private;
 create table icash_ranker_private.samples(id uuid);
 create table icash_opportunity_refreshes(account_id uuid,refreshed_at timestamptz);
 create table icash_sms_seller_openings(account_id uuid,thread_id uuid,interest_message_id uuid);
 set check_function_bodies=false;`);
 try{
  for(const f of JSON.parse(read('tests/fixtures/interest-evidence-before.json')))await db.exec(f.definition);
  const migration=read('config/seller-interest-evidence.sql');
  assert.equal(migration,read('supabase/migrations/20261028221449_seller_interest_evidence.sql'));
  await db.exec(migration);
  const reviewedQuestion=read('config/seller-interest-reviewed-question.sql');
  assert.equal(reviewedQuestion,read('supabase/migrations/20261104052316_seller_interest_reviewed_question.sql'));
  await db.exec(reviewedQuestion);
 }finally{await db.exec('set check_function_bodies=true');}
}
