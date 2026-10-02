// LOCAL ONLY: an existing official PGlite package, in-memory DB, real prerequisite
// SQL and synthetic rollback fixtures. No provider/network/live database access.
// Usage: node --experimental-strip-types scripts/test-call-property-context-pglite.mjs /absolute/path/to/pglite/dist/index.js
import {createJourneyDb,read} from '../tests/helpers/simulated-journey-db.mjs';
const {pg}=await createJourneyDb(process.argv[2]);
try{
 // Journey prerequisites load the pricing trigger but not this unrelated table.
 // Use its real DDL without enabling/seeding any price or message worker.
 const prices=read('config/text-ai.sql'),start=prices.indexOf('create table public.icash_communication_prices(');
 await pg.exec(prices.slice(start,prices.indexOf(';',start)+1));
 await pg.exec(read('config/call-property-context.sql'));
 await pg.exec(read('tests/call-property-context-database.sql'));
 console.log('PASS actual inbound admission + read-only context: exact capability/tenant/party, safe first-name evidence, private-data exclusion, expiry and grants.');
 // Install actual reception prerequisites with synthetic local rate rows.
 const cats=['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'];
 const costs=JSON.stringify(Object.fromEntries(cats.map(c=>[c,c==='elevenlabs'?100000:0])));
 await pg.query(`insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values
 ('e827a7c9-8648-4999-885c-f136fd07100e','incoming_call','context-fixture-normal',430,$1,'local fixture',now()-interval '1 day',now()+interval '2 days',true,600),
 ('f93ace00-83fc-4d09-a37c-6d9d9f0a38f0','incoming_call','context-fixture-quick',65,$1,'local fixture',now()-interval '1 day',now()+interval '2 days',true,60)`,[costs]);
 for(const file of ['general-reception','general-reception-customer-funding','reception-property-context'])await pg.exec(read('config/'+file+'.sql'));
 await pg.exec(read('tests/reception-property-context-database.sql'));
 console.log('PASS actual reception admission + read-only context: default-off, accepted invitation, exact tenant/party, ambiguous privacy, self-introduced first name, manual/pause/suppression holds, unchanged wallet and private grants.');
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await pg.close();}
