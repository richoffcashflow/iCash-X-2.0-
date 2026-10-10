// Eight local scenarios. Uses an in-memory Postgres fixture and no provider client.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {closingSetupNext,payoutPreferenceSchema,closingSetupInput,closingPayoutNote} from '../lib/closing-setup.ts';
import {closingSummary} from '../lib/closing-progress.ts';
process.on('uncaughtException',e=>{console.error(e.message,e.where??'');process.exit(1);});
const {PGlite}=await import(process.argv[2]);
const db=new PGlite();
const account='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',deal='33333333-3333-4333-8333-333333333333',screen='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
await db.exec(`
create role anon;create role authenticated;create role service_role;
create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false);
create table icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb);
create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb);
create table icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean);
create table icash_operation_rates(id uuid primary key,operation text,enabled boolean,expires_at timestamptz,verified_at timestamptz);
create table icash_operating_budget(id int primary key);
create table icash_operation_spend(operation_key text,account_id uuid,rate_id uuid);
create table icash_title_replies(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,sender_verified boolean,body_text text);
create table icash_buyer_viewing_requests(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,screening_id uuid,state text,quote text,coordination_quote text);
create table icash_closing_updates(account_id uuid,deal_id uuid,kind text);
create table icash_property_controls(account_id uuid,property_id text,manual boolean,updated_at timestamptz default now(),primary key(account_id,property_id));
create function icash_claim_operation(text) returns boolean language sql as $$ select false $$;
create function icash_set_work_control(p_user uuid,p_account uuid,p_action text,p_screening uuid) returns void language plpgsql as $$ begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Owner required';end if;
 if p_action not in ('takeover','return_to_bot') then raise exception 'Unexpected control';end if;
 insert into public.icash_property_controls(account_id,property_id,manual) values(p_account,'prop_fixture',p_action='takeover') on conflict(account_id,property_id) do update set manual=excluded.manual;
end $$;
create function icash_buyer_package_data(uuid,uuid) returns jsonb language sql as $$ select '{"askingPriceCents":11200000,"depositCents":200000,"titleSelectionStatus":"not_selected"}'::jsonb $$;
`);
await db.exec(await readFile(new URL('../config/title-requests.sql',import.meta.url),'utf8'));
await db.query(`insert into icash_accounts values($1,$2,false);`,[account,owner]);
await db.query(`insert into icash_screening_jobs values($1,$2,'{"propertyId":"prop_fixture"}');`,[screen,account]);
await db.query(`insert into icash_deal_files values($1,$2,$3,'under_contract','{"state":"TX","address":"45 Fixture Lane","titleEmail":""}');`,[deal,account,screen]);
await db.query(`insert into icash_signing_envelopes values($1,$2,$3,'purchase','completed',false);`,[screen,account,deal]);
await db.query(`insert into icash_operation_rates values($1,'title_email',true,now()+interval '1 day',now());`,[screen]);
await db.exec(await readFile(new URL('../config/closing-setup.sql',import.meta.url),'utf8'));
const one=async(sql,values=[])=>(await db.query(sql,values)).rows[0];
const save=(action,data,a=account,u=owner)=>db.query('select icash_save_closing_setup($1,$2,$3,$4,$5) result',[a,u,deal,action,data]);
const row=()=>one('select *,updated_at::text as updated_at from icash_closing_setup where deal_id=$1',[deal]);
const base={setup:null,verifiedContact:null,directory:[],buyerSuggestions:[],titleEmailInAgreement:null};
const title={company:'Fixture Local Title',closer:'Pat Closer',email:'pat@example.invalid',phone:'+12145550123'};
const payout={payeeName:'Fixture Holdings LLC',payeeType:'company',method:'check_mail',mailingAddress:'100 Fixture Avenue, Dallas TX 75201',detailsSharedWithTitle:false};
const confirm=async(revision)=>save('confirm_title',{revision:revision??(await row()).updated_at,independentContact:true,assignmentsAndCoverage:true,agreedByParties:true});
let passed=0;
async function scenario(name,fn){await fn();passed++;console.log(`PASS ${passed}/8 ${name}`);}

await scenario('Buyer names a local title company; preference is saved without selecting it',async()=>{
 await save('title_preference',{...title,closer:'',email:'',phone:''});
 assert.equal(closingSetupNext({...base,setup:await row()}).code,'verify_preference');
 await assert.rejects(confirm());
 assert.equal((await one('select count(*)::int n from icash_title_contacts')).n,0);
 assert.equal((await one('select count(*)::int n from icash_title_requests')).n,0);
});
await scenario('No title coverage routes to human research; candidates are never auto-approved',async()=>{
 assert.equal(closingSetupNext(base).code,'research_required');
 assert.equal(closingSetupNext({...base,directory:[{name:'Fixture candidate'}]}).code,'review_directory');
 assert.equal((await one('select count(*)::int n from icash_operation_spend')).n,0);
});
await scenario('Owner verifies closer for an undecided contract; named-closer conflicts and stale approval are blocked',async()=>{
 await save('title_preference',title);
 await assert.rejects(confirm('2000-01-01T00:00:00Z'));
 await db.query(`update icash_deal_files set terms=terms||'{"titleEmail":"different@example.invalid"}' where id=$1`,[deal]);
 await assert.rejects(confirm());
 await db.query(`update icash_deal_files set terms=terms||'{"titleEmail":""}' where id=$1`,[deal]);
 await confirm();
 assert.equal((await one('select enabled from icash_title_contacts where deal_id=$1',[deal])).enabled,true);
 const request=(await one('select icash_prepare_title_request($1,$2) result',[account,deal])).result;
 assert.equal(request.state,'ready');
 assert.equal((await one('select terms from icash_deal_files where id=$1',[deal])).terms.titleEmail,'');
 assert.equal((await one('select icash_claim_title_request($1) claimed',[request.id])).claimed,false);
});
await scenario('Company payee and mailed check require an address; owner data stays out of buyer facts',async()=>{
 assert.equal(payoutPreferenceSchema.safeParse({...payout,mailingAddress:''}).success,false);
 await assert.rejects(save('payout',{...payout,mailingAddress:''}));
 await save('payout',payout);
 assert.equal((await row()).state,'ready');
 const buyer=(await one('select icash_buyer_package_data($1,$2) result',[account,deal])).result;
 assert.equal(buyer.titleSelectionStatus,'selected');
 assert(!JSON.stringify(buyer).includes('Fixture Holdings'));
 assert.deepEqual(Object.keys(buyer).sort(),['askingPriceCents','depositCents','titleSelectionStatus'].sort());
 assert.match(closingPayoutNote(payout),/verify the payee/i);
});
await scenario('Wire details use the closer’s secure process; banking fields and cross-account changes are rejected',async()=>{
 const wire={...payout,method:'wire',mailingAddress:''};
 assert.equal(closingSetupInput.safeParse({action:'payout',dealId:deal,data:{...wire,routingNumber:'111111111'}}).success,false);
 await assert.rejects(save('payout',{...wire,accountNumber:'1234567890'}));
 await assert.rejects(save('payout',wire,other,owner));
 await assert.rejects(save('payout',wire,account,other));
 await save('payout',wire);
 assert.equal(closingSetupNext({...base,setup:await row(),verifiedContact:{email:title.email}}).code,'secure_details');
 await save('payout',{...wire,detailsSharedWithTitle:true});
 await save('title_preference',{...title,phone:'+12145550124'});
 assert.equal((await row()).payout.detailsSharedWithTitle,false,'Changed closer details invalidate the earlier secure-sharing report');
 await confirm();
 for(const role of ['anon','authenticated']){
  assert.equal((await one("select has_table_privilege($1,'icash_closing_setup','select') allowed",[role])).allowed,false);
  assert.equal((await one("select has_function_privilege($1,'icash_save_closing_setup(uuid,uuid,uuid,text,jsonb)','execute') allowed",[role])).allowed,false);
 }
});
await scenario('Changed wire details or a title rejection pauses automation and creates an owner review',async()=>{
 const reply=async(body,verified)=>db.query('insert into icash_title_replies(account_id,deal_id,sender_verified,body_text) values($1,$2,$3,$4)',[account,deal,verified,body]);
 await reply('Please use the new wire instructions.',false);
 assert.equal((await row()).review_reason,'setup');
 await reply('Please use the new wire instructions.',true);
 assert.equal((await row()).review_reason,'payment_change');
 assert.equal((await row()).state,'needs_review');
 assert.equal((await one('select manual from icash_property_controls')).manual,true);
 await reply('We cannot handle assignments for this property.',true);
 assert.equal((await row()).review_reason,'title_declined');
});
await scenario('Human takeover acknowledges responsibility without a fake transfer or resuming automation',async()=>{
 await db.query('insert into icash_buyer_viewing_requests(account_id,deal_id,screening_id,state,quote) values($1,$2,$3,$4,$5)',[account,deal,screen,'needs_confirmation','I need a real person to handle title.']);
 assert.equal((await row()).review_reason,'human_requested');
 assert.equal((await row()).state,'needs_review');
 await save('takeover',{reason:'human_requested'});
 assert.equal((await row()).state,'acknowledged');
 assert.equal((await one('select manual from icash_property_controls')).manual,true);
 assert.equal(closingSetupNext({...base,setup:await row()}).code,'human_review');
 assert.equal((await one('select count(*)::int n from icash_closing_updates')).n,0);
 await db.query('select icash_set_work_control($1,$2,$3,$4)',[owner,account,'return_to_bot',screen]);
 assert.equal((await row()).review_reason,'setup');
 assert.equal((await one('select manual from icash_property_controls')).manual,false);
});
await scenario('Signed or closed does not mean paid; title-reported sending is not bank receipt',async()=>{
 assert.match(closingSummary([{kind:'closed'}]).next,/statement|payment timing/i);
 assert.match(closingSummary([{kind:'funds_disbursed'}]).next,/confirm receipt/i);
 await db.query("insert into icash_closing_updates values($1,$2,'funds_disbursed')",[account,deal]);
 await assert.rejects(save('payout',payout));
});
await db.close();
assert.equal(passed,8);
console.log('Eight local closing scenarios passed. Zero provider clients, emails, calls, wires or paid simulations.');
