// Isolated Postgres replay of the existing intake/opener functions. No providers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {sellerConsentVersion,sellerConsentText,sellerSharingText} from '../lib/seller-leads.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
const [account,screen,deal,thread,request]=Array.from({length:5},()=>randomUUID());
const phone='+12145550123',address='123 Example St, Dallas, TX 75210';
try{
 await pg.exec(`create table icash_accounts(id uuid primary key);create table icash_screening_jobs(id uuid primary key);create table icash_operation_spend(operation_key text primary key);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table icash_seller_events(lead_id uuid,event_name text,occurred_at timestamptz,evidence_ref text);
 create table icash_deal_files(id uuid,account_id uuid,screening_id uuid);
 create table icash_text_threads(id uuid,account_id uuid,deal_id uuid,seller_intake_id uuid,party text,retired_at timestamptz);
 create table icash_seller_recipient_ordinals(lead_id uuid,account_id uuid,recipient_ordinal integer);`);
 await pg.exec(read('supabase/migrations/20261004170451_seller_intake_and_budgeted_lead_assignment.sql').match(/create table public\.icash_seller_intakes \([\s\S]*?\n\);/)[0]);
 await pg.exec(read('supabase/migrations/20261005060500_homeoffer_contact_consent.sql').match(/alter table public\.icash_seller_intakes[\s\S]*?;/)[0]);
 await pg.exec(read('config/conversation-street-address.sql').match(/create function public\.icash_conversation_street[\s\S]*?\$\$;/)[0]);
 await pg.exec(read('tests/fixtures/seller-address-phone-current.sql'));
 const args=[request,'a'.repeat(64),null,address,phone,'b'.repeat(64),true,sellerConsentVersion,sellerConsentText,sellerSharingText,{contactTimezone:'America/Chicago',contactTimezoneSource:'seller_browser'},'c'.repeat(64),null];
 const submit=async(values=args)=>(await one('select icash_submit_seller_contact_intake('+values.map((_,i)=>'$'+(i+1)).join(',')+') id',values)).id;
 await assert.rejects(submit(),/not-null/);
 await pg.exec('begin;'+read('supabase/migrations/20261016200000_seller_optional_name.sql')+'commit;');
 const lead=await submit();assert.equal(await submit(),lead,'Nameless retries must be idempotent');
 const saved=await one('select name,phone,ai_consented,owner_claimed,consent_text from icash_seller_intakes where id=$1',[lead]);
 assert.deepEqual(saved,{name:null,phone,ai_consented:true,owner_claimed:false,consent_text:sellerConsentText});
 assert.equal((await one('select count(*)::int n from icash_seller_events')).n,1);
 const changed=[...args];changed[2]='Jane Seller';await assert.rejects(submit(changed),/retry mismatch/);
 const duplicate=[...args];duplicate[0]=randomUUID();const duplicateId=await submit(duplicate);
 assert.deepEqual(await one('select state,canonical_id from icash_seller_intakes where id=$1',[duplicateId]),{state:'duplicate',canonical_id:lead});
 for(const name of ['', 'x'.repeat(101)]){const invalid=[...args];invalid[0]=randomUUID();invalid[2]=name;await assert.rejects(submit(invalid),/name_check/);}
 const noConsent=[...args];noConsent[0]=randomUUID();noConsent[6]=false;await assert.rejects(submit(noConsent),/Contact agreement needed/);
 const named=[...args];named[0]=randomUUID();named[2]='Jane Seller';named[5]='d'.repeat(64);assert.equal((await one('select name from icash_seller_intakes where id=$1',[await submit(named)])).name,'Jane Seller');
 await q('insert into icash_seller_matches values($1,$2,$3)',[lead,account,screen]);
 await q('insert into icash_deal_files values($1,$2,$3)',[deal,account,screen]);
 await q("insert into icash_text_threads values($1,$2,$3,$4,'seller',null)",[thread,account,deal,lead]);
 await q('insert into icash_seller_recipient_ordinals values($1,$2,1)',[lead,account]);
 const opener=async(acct=account)=>(await one('select icash_seller_recipient_opener($1,$2,null,$3,$4) body',[acct,thread,'Fixture Buyer',address])).body;
 assert.equal(await opener(),'Is this the owner of 123 Example St? I am reaching out about a possible cash offer.');
 assert.equal(await opener(randomUUID()),null,'Cross-account copy remains unavailable');
 for(const ordinal of [2,3]){await q('update icash_seller_recipient_ordinals set recipient_ordinal=$1',[ordinal]);const body=await opener();assert.match(body,/123 Example St/);assert(!/null|undefined|Homeowner/.test(body));assert(body.length<=160);}
 const call=await one('select icash_seller_call_request($1,$2,$3) context',[account,screen,phone]);
 assert.equal(call.context.name,null);assert(Number.isFinite(Date.parse(call.context.submittedAt)));
 assert.equal((await one('select icash_seller_call_request($1,$2,$3) context',[account,screen,'+12145550999'])).context,null);
 console.log('PASS nameless intake, immutable consent, idempotency, duplicate binding, legacy names, owner-first SMS variants and phone-bound call context.');
}finally{await pg.close();}
