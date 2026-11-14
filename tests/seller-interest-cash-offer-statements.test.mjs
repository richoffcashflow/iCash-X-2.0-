import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {sellerInterestPatterns,sellerInterestQuote} from '../lib/seller-interest-evidence.ts';
import {liveConversationResult} from '../lib/deal-conversation.ts';
import {installInterestEvidence} from './helpers/interest-evidence-fixture.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('config/seller-interest-cash-offer-statements.sql');
assert.equal(migration,read('supabase/migrations/20261114182439_seller_interest_cash_offer_statements.sql'));
const before=read('tests/fixtures/seller-interest-cash-offer-before.sql');
const question='Would you be interested in selling your property?';
const pair=answer=>[{role:'agent',message:question},{role:'user',message:answer}];
const positives=[
 "I'm interested in a cash offer.",
 'I’m interested in a cash offer.',
 'We are open to a cash offer for our house.',
 "How much cash? I'm interested in a cash offer. How much cash?",
 "I'm interested in selling, what can you offer?",
 'What is your offer? We want to sell our property.',
 'What’s your cash offer? We’re interested in selling our home. How much are you offering?',
 'I am  interested in\na cash offer for my property.',
];
const negatives=[
 "What's the offer?",'What is your offer?','How much cash?','Depends on the offer',
 'I own the property.',"Yes, I'm the owner.",
 "I'm not interested in a cash offer.",
 "I'm interested in a cash offer if you pay a million dollars.",
 "I'm interested in a cash offer, maybe next year.",
 "I'm interested in selling, hypothetically.",
 "I'm interested in a cash offer for another property.",
 "I'm interested in selling my house but not this property.",
 "My wife said I'm interested in a cash offer.",
 "You asked if I'm interested in a cash offer.",
 "I am interested in a cash offer. Actually, no.",
 "I'm interested in a cash offer. What's your name?",
 "Please leave a message after the beep. I'm interested in a cash offer.",
];
const db=new PGlite();
const catalog=async()=> (await db.query(`select md5(pg_get_functiondef(p.oid)) hash,p.provolatile,p.prosecdef,p.proconfig,p.proacl::text acl
 from pg_proc p where p.oid='icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb)'::regprocedure`)).rows[0];
const classify=async result=>(await db.query('select icash_seller_interest_quote($1) quote,icash_call_selling_interest($1) interested',[result])).rows[0];
try{
 await db.exec('create role anon;create role authenticated;create role service_role;create table icash_screening_jobs(id uuid);');
 await db.exec(read('config/seller-response-policy.sql'));
 await db.exec(read('config/seller-optout-base-verbs.sql'));
 await db.exec(read('supabase/migrations/20261023175907_seller_call_contact_evidence.sql').match(/create or replace function public\.icash_call_has_seller_response[\s\S]*?\$\$;/)[0]);
 await installInterestEvidence(db);
 await db.exec('create schema icash_reliability_private;');
 await db.exec(before);
 await db.exec(`revoke all on function icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb) from public,anon,authenticated;
 grant execute on function icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb) to service_role;
 create or replace function public.icash_seller_interest_quote(p_result jsonb) returns text
 language plpgsql immutable security invoker set search_path='' as $fn$
 begin
 if jsonb_typeof(p_result->'transcript') is distinct from 'array'
  or p_result->>'contactEvidence' in ('automated_answer','no_response')
  or public.icash_seller_call_disposition(p_result) is not null then return null;end if;
 return icash_reliability_private.seller_interest_quote_from_clear_transcript(p_result);
 end $fn$;`);
 const original=await catalog();
 assert.equal(original.hash,'d724e64cd2be5c56372422738c380cd1','Fixture is the current live parser');
 assert.deepEqual(await classify({transcript:pair(positives[0]),interested:true}),{quote:null,interested:false},'Reproduce dropped explicit first-person cash-offer statement');
 await db.exec(before.replace('begin\n','begin\n-- unrelated unreviewed change\n'));
 const drifted=await catalog();
 await assert.rejects(db.exec(migration),/prerequisite changed/);
 await db.exec('rollback');
 assert.deepEqual(await catalog(),drifted,'Unknown definition is not overwritten');
 await db.exec(before);
 await db.exec(migration);
 const installed=await catalog();
 assert.equal(installed.hash,'18f28005c86c49c6f15e69cd7bcc7c1d');
 const {hash:beforeHash,...beforeAttributes}=original;
 const {hash:afterHash,...afterAttributes}=installed;
 assert.deepEqual(afterAttributes,beforeAttributes,'Invoker mode, volatility, search path and permissions are preserved');
 assert.ok(migration.includes(sellerInterestPatterns.explicit),'SQL and TypeScript use the exact same bounded pattern');
 for(const [body,expected] of [...positives.map(body=>[body,body]),...negatives.map(body=>[body,null])]){
  const transcript=pair(body);
  assert.equal(sellerInterestQuote(transcript),expected,body);
  for(const interested of [true,false]){
   const raw={transcript,interested,interestQuote:body};
   assert.deepEqual(await classify(raw),{quote:expected,interested:expected!==null},body);
   const source={conversation_id:'fixture',agent_id:'fixture',status:'done',transcript,analysis:{data_collection_results:{interested:{value:interested},interest_quote:{value:body}}}};
   const originalSource=structuredClone(source);
   const result=liveConversationResult(source,{conversationId:'fixture',agentId:'fixture',party:'seller'});
   assert.equal(result.interested,expected!==null,body);
   assert.equal(result.interestQuote,expected,body);
   assert.deepEqual(source,originalSource,'Saved source receipt remains immutable');
  }
 }
 // The observed compound phrase ended in a real opt-out. Improving recognition
 // must not turn that call into a positive or reinstate outreach authority.
 for(const withdrawal of ['Do not call me back.','Actually I do not want to sell.','No thanks']){
  const transcript=[...pair(positives[3]),{role:'user',message:withdrawal}];
  assert.equal(sellerInterestQuote(transcript),null,withdrawal);
  assert.deepEqual(await classify({transcript,interested:true}),{quote:null,interested:false},withdrawal);
 }
 for(const result of [null,{}, {interested:true}, {transcript:pair(positives[0]),optedOut:true},
  {transcript:pair(positives[0]),contactEvidence:'automated_answer'},
  {transcript:pair(positives[0]),contactEvidence:'no_response'},
  {transcript:[{role:'agent',message:positives[0]},{role:'user',message:'Hello'}]},
  {transcript:[{role:'agent',message:'Are you the owner?'},{role:'user',message:'Yes'}]},
 ])assert.equal((await classify(result)).interested,false,'Unsupported or excluded source cannot become a positive');
 await db.exec(migration);
 assert.deepEqual(await catalog(),installed,'Exact installed migration replay is inert');
 console.log('Seller explicit interest: whole-utterance SQL/TS/provider parity, exact live migration guard, immutable sources, ambiguous/other-property/refusal/opt-out negatives and idempotence passed.');
}finally{await db.close();}
