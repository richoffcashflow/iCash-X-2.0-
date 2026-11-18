import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {setup,read,seed,value,receipt,original} from './helpers/signing-receipt-discovery-fixture.mjs';
const sql=read('config/signing-receipt-discovery.sql');
assert.equal(sql,read('supabase/migrations/20261116231728_signing_receipt_discovery.sql'));
const db=new PGlite();
const issue=()=>value(db,'select public.icash_issue_due_signing_result()');
const state=r=>value(db,'select state from public.icash_signing_envelopes where id=$1',[r.envelope]);
const note=async(r,frozen)=>value(db,'select public.icash_note_signing_checkpoint_failure($1,$2,$3,$4,$5,$6)',[r.account,r.envelope,r.provider,r.hash,await value(db,'select to_jsonb(t) from icash_signing_templates t where id=$1',[r.template]),frozen??await original(db,r)]);
const record=(r,s='awaiting_counterparty',e=receipt(r,s),terminal=false)=>value(db,'select public.icash_record_signing_receipt($1,$2,$3,$4,$5,$6,$7)',[r.account,r.envelope,r.provider,r.hash,s,e,terminal]);
try{
 await db.exec(setup);
 for(const drift of ["revoke execute on function icash_claim_signing_poll(uuid,uuid) from service_role","alter function icash_save_signing_status(uuid,text,jsonb) security definer","alter table icash_automation_tickets drop constraint icash_automation_tickets_kind_check;alter table icash_automation_tickets add constraint icash_automation_tickets_kind_check check(kind<>'unsupported')"]){
  await db.exec('begin');await db.exec(drift);await assert.rejects(()=>db.exec(sql),/predecessor source or metadata changed|ticket kinds changed/);await db.exec('rollback');
  assert.equal(await value(db,"select to_regnamespace('icash_signing_receipt_private')"),null,'predecessor drift leaves no partial release');
 }
 const fresh=await seed(db,1,{age:44}),old=await seed(db,2,{age:46}),review=await seed(db,3,{state:'needs_review'});
 assert(await issue());assert.equal(await issue(),null,'original selector loses old and review receipts');
 assert.equal(await value(db,'select icash_claim_signing_poll($1,$2)',[old.account,old.envelope]),true,'the original provider poll itself supports old originals');
 await db.exec('begin;'+sql+'commit;');
 await db.exec("update icash_signing_envelopes set next_poll_at=now()-interval '1 minute',last_poll_at=null;delete from icash_automation_tickets");
 for(let n=0;n<3;n++)assert(await issue());
 assert.deepEqual((await db.query('select kind from icash_automation_tickets order by created_at,id')).rows.map(r=>r.kind).sort(),['signing_receipt','signing_receipt','signing_result']);
 assert.equal(await issue(),null,'one bounded next-poll reservation per original');
 const before=await value(db,'select to_jsonb(e) from icash_signing_envelopes e where id=$1',[review.envelope]);
 assert.equal(await record(review,'completed'), 'needs_review','historical review never clears from receipt evidence');
 assert.equal(await record(review,'completed'), 'needs_review');
 assert.deepEqual(await value(db,'select to_jsonb(e) from icash_signing_envelopes e where id=$1',[review.envelope]),before);
 assert.equal(await value(db,'select count(*)::int from icash_signing_receipt_private.observations where envelope_id=$1',[review.envelope]),1,'duplicate receipts retain one immutable observation');
 assert.equal(await value(db,'select stage from icash_deal_files where id=$1',[review.deal]),'draft');
 assert.equal(await value(db,'select charged_cents from icash_operation_spend where operation_key=$1',['signing:'+review.envelope]),null);
 for(const changed of [{id:'999'}, {metadata:{icash_envelope:review.envelope,terms_hash:'wrong'}}, {recipients:[{...receipt(review).recipients[0],email:'wrong@example.invalid'},receipt(review).recipients[1]]}])await assert.rejects(()=>record(review,'awaiting_counterparty',{...receipt(review),...changed}),/binding required/);
 for(const [n,field] of [[21,'terms'],[22,'recipients'],[23,'template']]){
  const r=await seed(db,n),frozen=await original(db,r);
  if(field==='terms')await db.query("update icash_signing_envelopes set terms=terms||'{\"priceCents\":200000}' where id=$1",[r.envelope]);
  if(field==='recipients')await db.query("update icash_signing_envelopes set recipients=jsonb_set(recipients,'{0,email}','\"changed@example.invalid\"') where id=$1",[r.envelope]);
  if(field==='template')await db.query('update icash_signing_envelopes set template_id=null where id=$1',[r.envelope]);
  assert.equal(await note(r,frozen),false,'pre-marker '+field+' edit cannot be recaptured as send-time authority');
 }
 const prospective=await seed(db,4);assert.equal(await note(prospective),true);assert.equal(await state(prospective),'needs_review');assert.equal(await note(prospective),false);
 assert.equal(await record(prospective),'awaiting_counterparty','exact prospective checkpoint restores only the original pending receipt');
 assert(await value(db,'select resolved_at from icash_signing_receipt_private.checkpoints where envelope_id=$1',[prospective.envelope]));
 assert.equal(await value(db,'select count(*)::int from icash_signature_authorizations'),0);
 for(const [n,hold] of [[5,'pause'],[6,'manual'],[7,'terms'],[8,'template'],[9,'state'],[10,'provider'],[11,'spend'],[15,'owner']]){
  const r=await seed(db,n);assert(await note(r));
  if(hold==='pause')await db.query('update icash_accounts set bot_paused=true where id=$1',[r.account]);
  if(hold==='manual')await db.query('insert into icash_property_controls(account_id,property_id,manual) values($1,$2,true)',[r.account,r.deal]);
  if(hold==='terms')await db.query("update icash_deal_files set terms=terms||'{\"priceCents\":200000}' where id=$1",[r.deal]);
  if(hold==='template')await db.query('update icash_signing_templates set enabled=false where id=$1',[r.template]);
  if(hold==='state')await db.query("update icash_signing_envelopes set state='needs_review' where id=$1",[r.envelope]);
  if(hold==='provider')await db.query("update icash_signing_envelopes set provider_status='Manual review' where id=$1",[r.envelope]);
  if(hold==='spend')await db.query("update icash_operation_spend set state='unknown' where operation_key=$1",['signing:'+r.envelope]);
  if(hold==='owner')await db.query('update icash_accounts set owner_user_id=null where id=$1',[r.account]);
  assert.equal(await record(r),'needs_review',hold+' must survive original receipt discovery');
 }
 const terminal=await seed(db,12,{state:'needs_review'}),terminalEvidence={...receipt(terminal),status:'Expired'};
 assert.equal(await record(terminal,'needs_review',terminalEvidence,true),'needs_review');
 await db.exec("update icash_signing_envelopes set next_poll_at=now()+interval '1 hour'");
 await db.query('update icash_signing_envelopes set next_poll_at=now() where id=$1',[terminal.envelope]);
 assert.equal(await issue(),null,'known terminal original receipt stops repeated polls without clearing review');
 const unknown=await seed(db,13,{state:'needs_review'});await record(unknown,'needs_review',{...receipt(unknown),status:'Unrecognized'});
 assert(await issue(),'unknown original receipt remains eligible for later bounded polling');
 const test=await seed(db,14,{test:true});assert(await note(test));assert.equal(await record(test,'test_completed'),'test_completed');
 assert.equal(await value(db,'select stage from icash_deal_files where id=$1',[test.deal]),'draft','test completion never advances real deal');
 await assert.rejects(()=>db.exec('update icash_signing_receipt_private.observations set terminal=false'),/immutable/);
 await assert.rejects(()=>db.exec("update icash_signing_receipt_private.checkpoints set source='{}'"),/immutable/);
 await db.exec('begin');await assert.rejects(()=>db.exec(sql),/predecessor source or metadata changed/);await db.exec('rollback');
 const metadata=(await db.query("select proname,prosecdef,proconfig,proacl::text from pg_proc where proname in ('icash_note_signing_checkpoint_failure','icash_record_signing_receipt')")).rows;
 assert.equal(metadata.length,2);for(const r of metadata){assert.equal(r.prosecdef,true);assert.deepEqual(r.proconfig,['search_path=""']);assert.equal(r.proacl,'{postgres=X/postgres,service_role=X/postgres}');}
 for(const role of ['anon','authenticated']){
  assert.equal(await value(db,'select has_schema_privilege($1,$2,$3)',[role,'icash_signing_receipt_private','USAGE']),false);
  assert.equal(await value(db,'select has_function_privilege($1,$2,$3)',[role,'icash_record_signing_receipt(uuid,uuid,text,text,text,jsonb,boolean)','EXECUTE']),false);
 }
 assert.equal(await value(db,"select has_table_privilege('service_role','icash_signing_receipt_private.checkpoints','UPDATE')"),false);
 console.log('Original signing receipt discovery: historical holds, exact bindings, prospective recovery, current authority, bounded selection, test-mode isolation and immutable evidence pass.');
}finally{await db.close();}
