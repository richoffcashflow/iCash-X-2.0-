import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export const migrationPath='supabase/migrations/20261116224257_title_negated_review.sql';
export const predecessorHash='e4b0354865c030ac2f1e08f83a585ba2';
export const resultHash='69845816123c51ef71cf746b10070521';
export async function sendTitleReview(db,request,text,{authenticated=true,sender='closer@example.invalid'}={}){
 const email=randomUUID();await db.query("select public.icash_record_title_reply($1,'T',$2,$3,'Fixture title reply',$4,$5)",[email,request,sender,text,authenticated]);
 return (await db.query('select * from public.icash_title_replies where provider_email_id=$1',[email])).rows[0];
}
export async function installTitleReviewFixture(db){
 await db.exec(readFileSync('tests/fixtures/title-review-schema.sql','utf8'));
 await db.exec(readFileSync('config/title-inbound.sql','utf8'));
 await db.exec(readFileSync('config/title-tasks.sql','utf8'));
 await db.exec(readFileSync('tests/fixtures/title-reply-review-predecessor.sql','utf8'));
 await db.exec(`revoke all on function public.icash_closing_reply_review() from public,anon,authenticated; grant execute on function public.icash_closing_reply_review() to service_role;
 create trigger icash_closing_reply_review after insert on public.icash_title_replies for each row execute function public.icash_closing_reply_review();`);
}
export async function titleReviewCase(db){
 const account=randomUUID(),deal=randomUUID(),request=randomUUID(),property='fixture-'+randomUUID();
 await db.query('insert into public.icash_accounts values($1)',[account]);
 await db.query('insert into public.icash_screening_jobs values($1,$2,$3)',[deal,account,{propertyId:property}]);
 await db.query("insert into public.icash_deal_files values($1,$2,$1,'under_contract')",[deal,account]);
 await db.query("insert into public.icash_title_requests values($1,$2,$3,'closer@example.invalid','sent')",[request,account,deal]);
 const send=(text,options)=>sendTitleReview(db,request,text,options);
 const state=async()=>({control:(await db.query('select * from public.icash_property_controls where account_id=$1 and property_id=$2',[account,property])).rows[0],setup:(await db.query('select * from public.icash_closing_setup where account_id=$1 and deal_id=$2',[account,deal])).rows[0],tasks:(await db.query('select * from public.icash_title_tasks where account_id=$1 and deal_id=$2',[account,deal])).rows,deal:(await db.query('select * from public.icash_deal_files where account_id=$1 and id=$2',[account,deal])).rows[0]});
 return {account,deal,request,property,send,state};
}
export async function reviewMetadata(db){return (await db.query(`select md5(pg_get_functiondef(oid)) source_hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text from pg_proc where oid='public.icash_closing_reply_review()'::regprocedure`)).rows[0];}
export async function runTitleNegatedReview(db,{beforeMigration}={}){
 await installTitleReviewFixture(db);
 const before=await reviewMetadata(db);assert.equal(before.source_hash,predecessorHash,'Fixture uses the exact current production predecessor');
 const historical=await titleReviewCase(db);await historical.send('No probate is required.');
 const old=await historical.state();assert.equal(old.control.manual,true);assert.equal(old.setup.review_reason,'title_issue');
 console.log('Reproduced: a verified explicit negation sets manual takeover in the predecessor.');
 const missedPayment=await titleReviewCase(db);await missedPayment.send('Please change the wire account.');
 assert.equal((await missedPayment.state()).control,undefined,'Reproduce bare change missing from the payment-prefix pattern');
 console.log('Reproduced: a verified bare change-before-wire instruction misses the original payment hold.');
 const migration=readFileSync(migrationPath,'utf8');assert.equal(migration,readFileSync('config/title-negated-review.sql','utf8'));
 await db.exec('grant execute on function public.icash_closing_reply_review() to authenticated');
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/metadata changed/);await db.exec('rollback');
 assert.equal((await reviewMetadata(db)).source_hash,predecessorHash,'ACL drift aborts without changing the source');
 await db.exec('revoke execute on function public.icash_closing_reply_review() from authenticated');
 const original=readFileSync('tests/fixtures/title-reply-review-predecessor.sql','utf8');
 await db.exec(original.replace('declare reason text;','declare /* simulated future source */ reason text;'));
 const drift=await reviewMetadata(db);
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/predecessor changed/);await db.exec('rollback');
 assert.deepEqual(await reviewMetadata(db),drift,'Source drift aborts atomically without overwriting newer code');
 await db.exec(original);assert.deepEqual(await reviewMetadata(db),before);
 if(beforeMigration)await beforeMigration(migration,before);
 await db.exec('begin;'+migration+'commit;');
 const after=await reviewMetadata(db);assert.deepEqual({...after,source_hash:before.source_hash},before,'Owner, ACL, volatility, search path and security mode stay unchanged');
 assert.equal(after.source_hash,resultHash,'The installed function has the reviewed exact resulting definition');
 assert.equal((await historical.state()).control.manual,true,'Installing the fix never clears historical controls');
 const negatives=[
  'No probate is required.','Probate is not required.','Probate isn’t required.','No legal review is needed.','Attorney review isn\'t needed.',
  'There is no lien.','There isn’t a lien.','There is not any lien.','No lien was found.','There is no dispute.','There is no lawsuit.',
  'There are no liens.','There aren’t any liens.','No liens were found.','There are no disputes.','No lawsuits have been identified.',
  'No legal reviews are required.','Attorney reviews aren’t needed.','No humans are required.','Real persons are not needed.',
  'We do not need a human.','We don’t need a real person.','A human is not required.','No real person is needed.',
  'Hello,\nNo probate is required.\nThanks.',
  'No probate is required.\n> A lien requires legal review.',
  'No probate is required.\n> Old issue.\nThere are no liens.',
  'No probate is required.\nThere are no liens.\nNo legal review is needed.',
  'No probate is required.\nOn November 1, the closer wrote:\nA lien requires legal review.',
  'No probate is required.\nFrom: Old quoted author\nA lawsuit is pending.',
  '> A lien requires legal review.',
  'No probate is required.\nSent: old message\nPlease change the wire account.',
  'No probate is required.\nBegin forwarded message:\nWe cannot accept this file.',
  'No probate is required.\n--\nAttorney review is required.'
 ];
 for(const text of negatives){const c=await titleReviewCase(db),reply=await c.send(text),state=await c.state();assert.equal(reply.sender_verified,true);assert.equal(state.control,undefined,text);assert.equal(state.setup,undefined,text);assert.equal(state.deal.stage,'under_contract');assert(state.tasks.some(t=>t.kind==='reply_review'&&t.reply_id===reply.id&&t.state==='needs_review'),'Original reply stays available; a negation is not title clearance');}
 const positives=[
  'Probate is required.','There is a lien.','There are liens.','There is a dispute.','There are disputes.','A lawsuit is pending.','Lawsuits are pending.','Legal review is needed.','Attorney review is required.','We need a human.','Please get a real person.',
  'No probate is required, but there is a lien.','No probate is required. A lien remains.','No lien was found; legal review is required.',
  'We do not know whether probate is required.','No lien? Please confirm.','Is no lien confirmed?','Probate is not required yet.','If there is no lien we can close.','No probate unless the court requires it.','No probate is required unless the court orders it.','There is no legal review yet.',
  'No probate is required\nunless the court orders it.','No probate is required.\nUnconfirmed.','There is no lien.\nIs that correct?',
  'No probate is required.\n> Old issue.\nProvided the heir signs.',
  'No probate is required.\n> There is no lien.\nA lien was found.'
 ];
 const qualifiers=['provided the heir signs','as long as the court agrees','however, our search is incomplete','but this is preliminary','subject to verification','except for the pending search results','assuming the records are complete','we are still checking','this may change','details to follow','please confirm','some unrelated additional text'];
 for(const negative of ['No probate is required','No lien was found','No liens were found'])for(const separator of ['\n','. ','; ','! ','\r\n'])for(const qualifier of qualifiers)positives.push(negative+separator+qualifier+'.');
 for(const text of positives){const c=await titleReviewCase(db);await c.send(text);const state=await c.state();assert.equal(state.control?.manual,true,text);assert.equal(state.setup?.state,'needs_review');assert.equal(state.deal.stage,'under_contract');}
 for(const text of ['Please change the wire account.','No probate is required. Please change the wire account.','The wire account has changed.','Do not change the wire account.','If needed, change the wire account.','No probate is required.\n> Old issue.\nPlease change the wire account.']){
  const c=await titleReviewCase(db);await c.send(text);const state=await c.state();assert.equal(state.control?.manual,true,text);assert.equal(state.setup?.review_reason,'payment_change');assert.equal(state.deal.stage,'under_contract');
 }
 for(const text of ['No lien was found. We cannot accept this file.','No probate is required. We can’t accept this file.','We are unable to handle this closing.']){const c=await titleReviewCase(db);await c.send(text);const state=await c.state();assert.equal(state.control?.manual,true,text);assert.equal(state.setup?.review_reason,'title_declined');}
 for(const options of [{authenticated:false},{sender:'impostor@example.invalid'}]){const c=await titleReviewCase(db),before=await c.state(),reply=await c.send('There is a lien.',options),state=await c.state();assert.equal(reply.sender_verified,false);assert.equal(reply.account_id,null);assert.equal(state.control,undefined);assert.equal(state.setup,undefined);assert.deepEqual(state.tasks,before.tasks,'Unverified mail creates no tasks and does not cancel the existing follow-up');}
 const unknown=await sendTitleReview(db,randomUUID(),'There is a lien.');assert.equal(unknown.sender_verified,false);assert.equal(unknown.account_id,null);
 const unavailable=await titleReviewCase(db);await db.query("update public.icash_title_requests set state='queued' where id=$1",[unavailable.request]);
 const unavailableBefore=await unavailable.state(),unavailableReply=await unavailable.send('There is a lien.');assert.equal(unavailableReply.sender_verified,false);assert.deepEqual(await unavailable.state(),unavailableBefore,'A reference to an unsent request does not create a trusted title exception');
 const tenantA=await titleReviewCase(db),tenantB=await titleReviewCase(db),tenantBefore=await tenantB.state();await tenantA.send('There is a lien.');assert.deepEqual(await tenantB.state(),tenantBefore,'A verified reply is bound to its original request account and deal');
 const preserved=await titleReviewCase(db);await preserved.send('There is a lien.');const established=await preserved.state();await preserved.send('There is no lien.');const later=await preserved.state();assert.deepEqual(later.control,established.control);assert.deepEqual(later.setup,established.setup,'A later negative statement never clears an existing exception or switches its source');
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.icash_closing_reply_review()','execute') allowed",[role])).rows[0].allowed,false);
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/predecessor/i,'The migration cannot be replayed against a changed source');await db.exec('rollback;');
 console.log('PASS: verified-source title trigger retains genuine and ambiguous holds, ignores only explicit negative clauses, keeps original tasks and never clears prior controls. Resulting source hash: '+after.source_hash);
 return {before,after};
}
