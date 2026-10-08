// In-memory scope verification. No live calls, data changes or provider traffic.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
process.on('uncaughtException',e=>{console.error(e.message,e.where??'');process.exit(1);});
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const q=(s,p=[])=>pg.query(s,p),one=async(s,p=[])=>(await q(s,p)).rows[0];
const account=randomUUID(),other=randomUUID(),screen=randomUUID(),session=randomUUID(),phone='+12125550123';
await pg.exec(`create role anon;create role authenticated;create role service_role;
create schema icash_recorded_reception_private;
create table icash_recorded_reception_private.sessions(id uuid,account_id uuid,from_phone text,nonce_hash text);
create table icash_deal_files(account_id uuid,screening_id uuid,terms jsonb,stage text);
create table icash_customer_identities(account_id uuid,company_name text);
create table icash_live_conversations(account_id uuid,screening_id uuid,contact_key text,party text,state text,operation_key text,completed_at timestamptz,result jsonb);
create function icash_voice_sms_context(p_account uuid,p_permission uuid) returns jsonb language sql as $$select '{}'::jsonb limit 12$$;
create function icash_reception_context_before_payoff(p_id uuid,p_nonce_hash text) returns jsonb language sql set search_path='' as $$select '{"status":"matched","address":"123 Fixture Street"}'::jsonb from icash_recorded_reception_private.sessions where id=p_id and nonce_hash=p_nonce_hash$$;
create function icash_recorded_reception_property_context(p_id uuid,p_nonce_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;company text;
begin
 context:=public.icash_reception_context_before_payoff(p_id,p_nonce_hash);
 if context is null or context->>'status' not in ('matched','buyer') then return context;end if;
 select nullif(btrim(i.company_name),'') into company
 from icash_recorded_reception_private.sessions s join public.icash_customer_identities i on i.account_id=s.account_id
 where s.id=p_id and s.nonce_hash=p_nonce_hash;
 return context||jsonb_build_object('companyName',company);
end $$;
revoke all on function icash_recorded_reception_property_context(uuid,text) from public,anon,authenticated;
grant execute on function icash_recorded_reception_property_context(uuid,text) to service_role;`);
await pg.exec(readFileSync(new URL('../config/seller-call-history-continuity.sql',import.meta.url),'utf8'));
await q('insert into icash_recorded_reception_private.sessions values($1,$2,$3,\'nonce\')',[session,account,phone]);
await q("insert into icash_deal_files values($1,$2,'{\"address\":\"123 Fixture Street\"}','draft')",[account,screen]);
await q("insert into icash_customer_identities values($1,'Example Buyer')",[account]);
for(const [a,s,p,party,state,op,label] of [[account,screen,phone,'seller','complete','voice:one','correct history'],[other,screen,phone,'seller','complete','voice:two','other tenant'],[account,randomUUID(),phone,'seller','complete','voice:three','other property'],[account,screen,'+12125550124','seller','complete','voice:four','other phone'],[account,screen,phone,'buyer','complete','voice:five','buyer'],[account,screen,phone,'seller','waiting','voice:six','active call'],[account,screen,phone,'seller','complete','practice:seven','practice']]){
 await q("insert into icash_live_conversations values($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),$4,$5,$6,now(),$7)",[a,s,p,party,state,op,{transcript:[{role:'user',message:label}],summary:label,privateField:'not sent'}]);
}
const context=async(nonce='nonce')=>(await one('select icash_recorded_reception_property_context($1,$2) value',[session,nonce])).value;
let result=await context();assert.equal(result.priorCalls.length,1);assert.equal(result.priorCalls[0].result.summary,'correct history');assert(!JSON.stringify(result).includes('privateField'));assert.equal(await context('wrong'),null);
await q("insert into icash_deal_files values($1,$2,'{\"address\":\"123 Fixture Street\"}','draft')",[account,randomUUID()]);
assert.equal((await context()).priorCalls,undefined,'Ambiguous property cannot join call history');
await q('set role anon');await assert.rejects(()=>context(),/permission denied/);await assert.rejects(()=>q('select icash_seller_prior_call_context($1,$2,$3)',[account,screen,phone]),/permission denied/);
await pg.close();console.log('Seller history: exact account/property/phone/party, completed live calls only, nonce, ambiguity and public ACL checks passed.');
