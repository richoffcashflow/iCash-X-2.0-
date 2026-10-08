import assert from 'node:assert/strict';
import {sellerOfferReceptionPolicyHash,sellerOfferReceptionVariables} from '../../lib/seller-offer-reception.ts';
export async function testReceptionContactContinuity(f){
 const {db,q,val,rpc,read,scenario,account,reserve,trans,boundPayload,startPayload}=f;
 await db.exec(`alter table public.icash_text_threads add seller_intake_id uuid;
 alter table public.icash_sms_conversation_focus add source_id uuid;
 alter table public.icash_contact_permissions add buyer_id uuid;
 create table public.icash_seller_intakes(id uuid,name text,phone text,state text,data_rights_until timestamptz);
 create table public.icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table public.icash_buyer_profiles(id uuid,account_id uuid,display_name text,discovery jsonb);
 create table public.icash_buyer_candidates(buyer_id uuid,deal_id uuid,rights_until timestamptz,discovered_at timestamptz);
 create view public.icash_voice_contact_targets as select * from public.icash_contact_permissions;
 create function public.icash_buyer_package_data(p_account uuid,p_deal uuid) returns jsonb language sql as $$
  select jsonb_build_object('address',terms->>'address','purchasePriceCents',10000000,'assignmentFeeCents',1000000,'askingPriceCents',11000000)
  from public.icash_deal_files where id=p_deal and account_id=p_account and stage='under_contract'
 $$;`);
 // Use the real deployed buyer wrapper so its migration prerequisite is checked.
 await db.exec(f.fn('config/buyer-introduction-calls.sql','icash_buyer_voice_context'));
 await db.exec(read('config/reception-contact-continuity.sql'));
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',message='33333333-3333-4333-8333-333333333333';
 async function call(){
  const admission=await reserve({context_policy:'seller_offer_v2',context_policy_hash:sellerOfferReceptionPolicyHash,context_approval_reference:'Synthetic named return-call context'});assert(admission.allowed);
  let r=admission.session;await trans('claim_setup');await trans('bounded',boundPayload(r));await trans('bind_call_start',startPayload(r));
  r=await trans('authorize_recording',{nonceHash:r.nonce_hash,policy:'direct_recorded_v1'});await trans('claim_start');await trans('started',{recordingSid:'RE'+'c'.repeat(32),providerStartedAt:r.recording_authorized_at});
  return {r,lookup:()=>rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash})};
 }
 async function property(id,address,phone,party='seller'){
  await q('insert into public.icash_screening_jobs(id,account_id,snapshot) values($1,$2,$3)',[id,account,{propertyId:id}]);
  await q("insert into public.icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$1,$3,jsonb_build_object('address',$4::text))",[id,account,party==='buyer'?'under_contract':'draft',address]);
  await q("insert into public.icash_text_threads(id,account_id,deal_id,party,recipient,sender,paused,seller_intake_id) values($1,$2,$1,$3,$4,'+14243948384',false,$5)",[id,account,party,phone,party==='seller'?id:null]);
  await q("insert into public.icash_text_messages(id,account_id,thread_id,direction,state,created_at,body,provider_id) values(gen_random_uuid(),$1,$2,'outgoing','delivered',now()-interval '4 hours',$3,'synthetic')",[account,id,'About '+address]);
 }
 async function namedSeller(id,name,phone){
  await q("insert into public.icash_seller_intakes values($1,$2,$3,'assigned',now()+interval '1 day')",[id,name,phone]);
  await q('insert into public.icash_seller_matches values($1,$2,$1)',[id,account]);
 }
 async function focus(thread,phone){
  await q("insert into public.icash_text_messages(id,account_id,thread_id,direction,state,created_at,body) values($1,$2,$3,'incoming','received',now()-interval '3 hours','Hey')",[message,account,thread]);
  await q("insert into public.icash_sms_routes values('+14243948384',$1,$2,10,false)",[phone,account]);
  await q("insert into public.icash_sms_conversation_focus(sender,recipient,account_id,thread_id,route_revision,expires_at,source_id) values('+14243948384',$1,$2,$3,10,now()-interval '1 hour',$4)",[phone,account,thread,message]);
 }
 await scenario('return call keeps the named property after SMS focus expiration and never rewrites SMS',async()=>{
  const {r,lookup}=await call();await property(a,'45 Oak Road',r.from_phone);await property(b,'67 Pine Road',r.from_phone);await namedSeller(a,'JAMES Ross',r.from_phone);await namedSeller(b,'Other Person',r.from_phone);await focus(a,r.from_phone);
  const original=await val('select to_jsonb(f) from public.icash_sms_conversation_focus f');
  const context=await lookup();assert.equal(context.address,'45 Oak Road');assert.equal(context.returningName,'JAMES');
  const greeting=sellerOfferReceptionVariables(context).icash_property_greeting;assert.equal(greeting,'Hi James. Is this the owner of 45 Oak Road?');
  assert(!JSON.stringify(sellerOfferReceptionVariables(context)).includes('Ross'));
  assert.deepEqual(await val('select to_jsonb(f) from public.icash_sms_conversation_focus f'),original);
  await q('update public.icash_sms_routes set revision=11');assert.equal((await lookup()).status,'ambiguous');
  await q('update public.icash_sms_routes set revision=10,needs_review=true');assert.equal((await lookup()).status,'ambiguous');
  await q('update public.icash_sms_routes set needs_review=false');
  await q("update public.icash_text_messages set created_at=now()-interval '31 days' where id=$1",[message]);assert.equal((await lookup()).status,'ambiguous');
  await q("update public.icash_text_messages set created_at=now()-interval '3 hours' where id=$1",[message]);
  await q("insert into public.icash_text_messages(id,account_id,thread_id,direction,state,created_at,body) values(gen_random_uuid(),$1,$2,'outgoing','ready',now()-interval '1 minute','A different property')",[account,b]);
  assert.equal((await lookup()).status,'ambiguous');
 });
 await scenario('greeting name is bound to exact account property role and phone',async()=>{
  const {r,lookup}=await call();await property(a,'45 Oak Road',r.from_phone);await namedSeller(a,'Jane Smith',r.from_phone);
  const name=(acc=account,deal=a,party='seller',phone=r.from_phone)=>val('select icash_recorded_reception_private.contact_first_name($1,$2,$3,$4)',[acc,deal,party,phone]);
  assert.equal(await name(),'Jane');assert.equal(await name(account,b),null);assert.equal(await name(account,a,'buyer'),null);assert.equal(await name(account,a,'seller','+12125550198'),null);assert.equal(await name(b),null);
  await q("update public.icash_seller_intakes set name='Jane Properties LLC'");assert.equal(await name(),null);assert.equal((await lookup()).returningName,null);
  await q("update public.icash_seller_intakes set name='Jane Smith',data_rights_until=now()-interval '1 second'");assert.equal(await name(),null);
 });
 await scenario('buyer return call uses buyer name and exact buyer price without seller fields',async()=>{
  const {r,lookup}=await call();await property(a,'45 Oak Road',r.from_phone,'buyer');
  await q("insert into public.icash_buyer_profiles values($1,$2,'Alex Jones','{}')",[b,account]);
  await q("insert into public.icash_buyer_candidates values($1,$2,now()+interval '1 day',now())",[b,a]);
  await q("insert into public.icash_contact_permissions(id,account_id,screening_id,party,phone,permission_until,buyer_id) values($1,$2,$3,'buyer',$4,now()+interval '1 day',$5)",[message,account,a,r.from_phone,b]);
  const context=await lookup();assert.equal(context.status,'buyer');assert.equal(context.returningName,'Alex');assert.equal(context.askingPriceCents,11000000);
  const variables=sellerOfferReceptionVariables(context);assert.equal(variables.icash_property_greeting,'Hi Alex. Are you calling about buying 45 Oak Road?');assert(!variables.icash_property_context.includes('sellerOffer'));assert(!JSON.stringify(variables).includes('Jones'));
  await q("update public.icash_contact_permissions set revoked_at=now()");assert.equal((await lookup()).returningName,null);
 });
 for(const role of ['anon','authenticated'])for(const fn of ['return_call_focus(uuid,text,timestamptz)','contact_first_name(uuid,uuid,text,text)'])assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,'icash_recorded_reception_private.'+fn]),false);
}
