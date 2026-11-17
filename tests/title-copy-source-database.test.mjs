import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {installTitleCopyFixture,installTitleCopyMigration,titleCopyCase,sendTitleCopyReply} from './fixtures/title-copy-fixture.mjs';
const db=new PGlite();
try{
 await installTitleCopyFixture(db);await installTitleCopyMigration(db);
 const parse=async text=>(await db.query('select icash_title_copy_private.requested_documents($1) value',[text])).rows[0].value;
 for(const text of ['Please send the executed purchase agreement.','Could you please email us a copy of the signed purchase contract?','Hello,\nPlease send the purchase agreement.\nThanks.'])assert.deepEqual(await parse(text),['purchase'],text);
 assert.deepEqual(await parse('Please send the signed purchase and assignment agreements.'),['purchase','assignment']);
 assert.deepEqual(await parse('Please provide the payoff statement and company documents.'),['payoff','entity']);
 for(const text of ['Do not send the purchase agreement.','Please send the purchase agreement if the buyer agrees.','Please send the purchase agreement\nprovided the seller signs.','Please send the purchase agreement to someone@example.invalid.','Please send the purchase agreement and change the wire account.','Please send the executed purchase agreement. Also update the price.','Please send the purchase agreement\n--\nprovided the buyer agrees.','Please send the purchase agreement\n> unless the buyer agrees.'])assert.equal(await parse(text),null,text);
 const c=await titleCopyCase(db),reply=await sendTitleCopyReply(db,c,'Please send the purchase agreement.');
 assert.equal(reply.sender_verified,true);assert.equal(reply.original_source.bodyComplete,true);assert(reply.original_source.revision>0);
 assert.equal((await db.query("select count(*)::int n from public.icash_title_tasks where reply_id=$1 and kind='document_update'",[reply.id])).rows[0].n,0,'Disabled policy cannot create a send');
 const old=await sendTitleCopyReply(db,c,'Please send the purchase agreement.',{legacy:true});assert.deepEqual(old.original_source,{});
 const incomplete=await sendTitleCopyReply(db,c,'Please send the purchase agreement.',{source:{bodyComplete:false}});assert.equal(incomplete.original_source.bodyComplete,false);
 const unverified=await sendTitleCopyReply(db,c,'Please send the purchase agreement.',{authenticated:false});assert.equal(unverified.account_id,null);assert.deepEqual(unverified.original_source,{});
 // Prospective capture and actual inherited financial claim.
 await db.exec("update icash_title_copy_private.policy set enabled=true,activated_at=now()-interval '1 minute',release_sha=repeat('a',40)");
 const taskFor=async r=>(await db.query('select * from public.icash_title_tasks where reply_id=$1 and source_key=$2',[r.id,'review:'+r.id])).rows[0];
 for(const options of [{legacy:true},{source:{bodyComplete:false}},{source:{providerReceivedAt:new Date(Date.now()-120000).toISOString()}},{source:{providerReceivedAt:new Date(Date.now()+60000).toISOString()}}]){
  const c=await titleCopyCase(db),r=await sendTitleCopyReply(db,c,'Please send the purchase agreement.',options);
  assert.equal((await taskFor(r)).kind,'reply_review','missing, stale, future or legacy original evidence stays review');
 }

 const fresh=await titleCopyCase(db),fr=await sendTitleCopyReply(db,fresh,'Please send the purchase and assignment agreements.'),ft=await taskFor(fr);
 assert.equal(ft.kind,'document_update');assert.equal(ft.payload.documents.length,2);assert.equal(ft.state,'scheduled');
 await db.query("update public.icash_title_tasks set email_state='issued' where id=$1",[ft.id]);
 const claim=()=>db.query('select public.icash_claim_title_update($1,$2,$3) value',[fresh.account,ft.id,ft.payload]);
 assert((await claim()).rows[0].value);assert.equal((await claim()).rows[0].value,null,'one original claim only');
 assert.equal((await db.query('select count(*)::int n from public.icash_operation_spend where operation_key=$1',['title-followup:'+ft.id])).rows[0].n,1);
 assert.equal((await db.query('select public.icash_finish_title_copy($1,$2,$3) value',[fresh.account,ft.id,'original-email'])).rows[0].value,true);
 assert.equal((await db.query('select needs_review from public.icash_title_replies where id=$1',[fr.id])).rows[0].needs_review,false);
 assert.deepEqual((await db.query('select state,email_state,email_provider_id from public.icash_title_tasks where id=$1',[ft.id])).rows[0],{state:'done',email_state:'sent',email_provider_id:'original-email'});
 assert.equal((await db.query('select public.icash_finish_title_copy($1,$2,$3) value',[fresh.account,ft.id,'original-email'])).rows[0].value,true,'same original receipt is idempotent');
 assert.equal((await db.query('select public.icash_finish_title_copy($1,$2,$3) value',[fresh.account,ft.id,'different-email'])).rows[0].value,false,'conflicting receipt is refused');
 // Task edits cannot gain completion/cleanup authority from an original receipt.
 for(const edit of ["label='Owner added evidence review'","payload=payload||'{\"manualReview\":true}'::jsonb","due_date=current_date+1","state='dismissed'","reply_id=null"]){
  const c=await titleCopyCase(db),r=await sendTitleCopyReply(db,c,'Please send the purchase agreement.'),t=await taskFor(r);
  await db.query("update public.icash_title_tasks set email_state='issued' where id=$1",[t.id]);
  assert((await db.query('select public.icash_claim_title_update($1,$2,$3) value',[c.account,t.id,t.payload])).rows[0].value);
  await db.query('update public.icash_title_tasks set '+edit+' where id=$1',[t.id]);
  const before=(await db.query('select * from public.icash_title_tasks where id=$1',[t.id])).rows[0];
  assert.equal((await db.query('select public.icash_finish_title_copy($1,$2,$3) value',[c.account,t.id,'edited-original'])).rows[0].value,true);
  const after=(await db.query('select * from public.icash_title_tasks where id=$1',[t.id])).rows[0];
  assert.equal(after.state,before.state,edit+' preserves manual work');assert.equal(after.payload.manualReview,before.payload.manualReview);assert.equal(after.label,before.label);assert.equal(after.reply_id,before.reply_id);
  assert.equal((await db.query('select needs_review from public.icash_title_replies where id=$1',[r.id])).rows[0].needs_review,true,edit+' preserves the review');
  assert.equal((await db.query('select provider_id from icash_title_copy_private.receipts where task_id=$1',[t.id])).rows[0].provider_id,'edited-original','Original provider evidence is durable even if association changed');
  assert.equal((await db.query('select public.icash_finish_title_copy($1,$2,$3) value',[c.account,t.id,'edited-original'])).rows[0].value,true);
  assert.deepEqual((await db.query('select * from public.icash_title_tasks where id=$1',[t.id])).rows[0],after,'Duplicate receipt does not touch task disposition or clocks');
 }
 // The original operation must belong to this request's rate and chronology.
 for(const edit of ["rate_id=gen_random_uuid()","dispatched_at=now()-interval '3 hours'"]){
  const c=await titleCopyCase(db);await db.query('update public.icash_operation_spend set '+edit+' where operation_key=$1',['title:'+c.request]);
  const r=await sendTitleCopyReply(db,c,'Please send the purchase agreement.');assert.equal((await taskFor(r)).kind,'reply_review');
 }
 // Even before dispatch, an edited work item is no longer the captured request.
 const edited=await titleCopyCase(db),er=await sendTitleCopyReply(db,edited,'Please send the purchase agreement.'),et=await taskFor(er);
 await db.query("update public.icash_title_tasks set email_state='issued',label='Manual expanded review' where id=$1",[et.id]);
 assert.equal((await db.query('select public.icash_prepare_title_copy($1,$2,$3) value',[edited.account,et.id,et.payload])).rows[0].value,null);
 assert.equal((await db.query('select public.icash_claim_title_update($1,$2,$3) value',[edited.account,et.id,et.payload])).rows[0].value,null);
 await assert.rejects(db.query('update icash_title_copy_private.receipts set provider_id=provider_id'),/immutable/);
 await assert.rejects(db.query('delete from icash_title_copy_private.receipts'),/immutable/);
 await assert.rejects(db.query('truncate icash_title_copy_private.receipts'),/immutable/);
 // A late original receipt is recorded atomically without dismissing a newer withdrawal.
 const late=await titleCopyCase(db),lar=await sendTitleCopyReply(db,late,'Please send the purchase agreement.'),lat=await taskFor(lar);
 await db.query("update public.icash_title_tasks set email_state='issued' where id=$1",[lat.id]);
 assert((await db.query('select public.icash_claim_title_update($1,$2,$3) value',[late.account,lat.id,lat.payload])).rows[0].value);
 const newer=await sendTitleCopyReply(db,late,'Do not send further documents.');
 assert.equal((await db.query('select public.icash_finish_title_copy($1,$2,$3) value',[late.account,lat.id,'late-original-receipt'])).rows[0].value,true);
 assert.equal((await db.query('select needs_review from public.icash_title_replies where id=$1',[newer.id])).rows[0].needs_review,true);
 assert.equal((await db.query('select needs_review from public.icash_title_replies where id=$1',[lar.id])).rows[0].needs_review,true);
 // Delivery order cannot renew an older original request after a newer withdrawal.
 const outOfOrder=await titleCopyCase(db);
 await sendTitleCopyReply(db,outOfOrder,'Do not send further documents.',{source:{providerReceivedAt:new Date(Date.now()-1000).toISOString()}});
 const delayed=await sendTitleCopyReply(db,outOfOrder,'Please send the purchase agreement.',{source:{providerReceivedAt:new Date(Date.now()-2000).toISOString()}});
 assert.equal((await taskFor(delayed)).kind,'reply_review');
 // Original copy evidence cannot be rewritten, deleted or truncated.
 await assert.rejects(db.query('update icash_title_copy_private.requests set source=source'),/immutable/);
 await assert.rejects(db.query('delete from icash_title_copy_private.requests'),/immutable/);
 await assert.rejects(db.query('truncate icash_title_copy_private.requests'),/immutable|foreign key constraint/);
 // Unknown historical dispatch never allows another send, even after dismissal.
 const unresolved=await titleCopyCase(db),ur=await sendTitleCopyReply(db,unresolved,'Please send the purchase agreement.'),ut=await taskFor(ur);
 await db.query("update public.icash_title_tasks set email_state='issued' where id=$1",[ut.id]);await db.query('select public.icash_claim_title_update($1,$2,$3)',[unresolved.account,ut.id,ut.payload]);
 await db.query("update public.icash_title_tasks set state='dismissed',email_state='needs_review' where id=$1",[ut.id]);
 const again=await sendTitleCopyReply(db,unresolved,'Please resend the purchase agreement.'),at=await taskFor(again);await db.query("update public.icash_title_tasks set email_state='issued' where id=$1",[at.id]);
 assert.equal((await db.query('select public.icash_claim_title_update($1,$2,$3) value',[unresolved.account,at.id,at.payload])).rows[0].value,null);
 // Newer unsupported/withdrawal source cancels only never-attempted work.
 const withdraw=await titleCopyCase(db),wr=await sendTitleCopyReply(db,withdraw,'Please send the purchase agreement.'),wt=await taskFor(wr);
 await sendTitleCopyReply(db,withdraw,'Do not send any documents.');assert.equal((await db.query('select state from public.icash_title_tasks where id=$1',[wt.id])).rows[0].state,'cancelled');
 // Unsupported acquisition remains a specific evidence task, never a guessed attachment.
 const missing=await titleCopyCase(db),mr=await sendTitleCopyReply(db,missing,'Please send the payoff statement and identification.'),mt=await taskFor(mr);
 assert.equal(mt.kind,'reply_review');assert.match(mt.label,/payoff, identification/);
 // Existing assignment update is awaited, not duplicated. Its exact receipt completes this request.
 const linked=await titleCopyCase(db),original=(await db.query("insert into public.icash_title_tasks(account_id,deal_id,request_id,source_key,kind,label,state,payload) values($1,$2,$3,$4,'document_update','Existing assignment','scheduled',$5) returning *",[linked.account,linked.deal,linked.request,'original:'+linked.request,{type:'assignment',envelopeId:linked.assignment}])).rows[0];
 const lr=await sendTitleCopyReply(db,linked,'Please send the assignment agreement.'),lt=await taskFor(lr);assert.equal(lt.payload.documents.length,0);assert.equal(lt.payload.linkedTasks[0].taskId,original.id);
 await db.query("update public.icash_title_tasks set email_state='issued' where id=$1",[lt.id]);
 const prepare=()=>db.query('select public.icash_prepare_title_copy($1,$2,$3) value',[linked.account,lt.id,lt.payload]);assert.equal((await prepare()).rows[0].value,null);
 await db.query("update public.icash_title_tasks set email_state='issued' where id=$1",[original.id]);assert((await db.query('select public.icash_claim_title_update($1,$2,$3) value',[linked.account,original.id,original.payload])).rows[0].value);
 await db.query("update public.icash_title_tasks set state='done',email_state='sent',email_provider_id='linked-receipt' where id=$1",[original.id]);
 assert.equal((await prepare()).rows[0].value.status,'covered_by_original_receipt');
 assert.equal((await db.query('select count(*)::int n from public.icash_operation_spend where operation_key=$1',['title-followup:'+lt.id])).rows[0].n,0);
 // Final claim checks current snapshot and all inherited account/contact/manual controls.
 for(const mutation of ["update public.icash_accounts set bot_paused=true where id=$1","update public.icash_title_contacts set enabled=false where account_id=$1","update public.icash_signing_envelopes set provider_id='changed' where account_id=$1","update public.icash_accounts set fixture_spending_allowed=false where id=$1","update public.icash_title_requests set provider_id=null where account_id=$1","update public.icash_deal_files set stage='cancellation_pending' where account_id=$1","insert into public.icash_property_controls(account_id,property_id,manual) select account_id,snapshot->>'propertyId',true from public.icash_screening_jobs where account_id=$1"]){
  const c=await titleCopyCase(db),r=await sendTitleCopyReply(db,c,'Please send the purchase agreement.'),t=await taskFor(r);await db.query("update public.icash_title_tasks set email_state='issued' where id=$1",[t.id]);await db.query(mutation,[c.account]);
  try{assert.equal((await db.query('select public.icash_claim_title_update($1,$2,$3) value',[c.account,t.id,t.payload])).rows[0].value,null);}catch(e){assert.match(e.message,/Fixture budget blocked/);}
  assert.equal((await db.query('select count(*)::int n from public.icash_operation_spend where operation_key=$1',['title-followup:'+t.id])).rows[0].n,0);
 }
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.icash_prepare_title_copy(uuid,uuid,jsonb)','execute') value",[role])).rows[0].value,false);
 console.log('PASS title-copy SQL: prospective exact source capture, original claim/receipt, withdrawal, immutable unknown sends, linked original assignment, missing evidence and inherited controls.');
}catch(e){console.error(e.message,e.code,e.where);process.exitCode=1;}finally{await db.close();}
