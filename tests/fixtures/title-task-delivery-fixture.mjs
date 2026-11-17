import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {installTitleCopyFixture,installTitleCopyMigration,titleCopyCase} from './title-copy-fixture.mjs';
export const titleTaskMigration=()=>readFileSync('config/title-task-delivery-source.sql','utf8');
export async function installTitleTaskFixture(db){
 await installTitleCopyFixture(db);await installTitleCopyMigration(db);await installTitleDeadlineSeed(db);
 const predecessor=JSON.parse(readFileSync('tests/fixtures/title-task-delivery-predecessors.json','utf8')).find(r=>r.signature==='icash_claim_title_followup(uuid,uuid)');
 await db.exec(predecessor.definition);
 await db.exec('revoke all on function public.icash_claim_title_followup(uuid,uuid) from public,anon,authenticated;grant execute on function public.icash_claim_title_followup(uuid,uuid) to service_role;');
}
export async function titleTaskCase(db,kind='assignment'){
 const c=await titleCopyCase(db);let task;
 if(kind==='follow_up')task=(await db.query("update public.icash_title_tasks set email_state='issued',due_date=(now() at time zone 'America/Chicago')::date where request_id=$1 and kind='follow_up' returning *",[c.request])).rows[0];
 else{
  const payout={payeeName:'Fixture LLC',payeeType:'company',method:'check_mail',mailingAddress:'100 Fixture Lane, Dallas TX 75201'};
  if(kind==='payout')await db.query('insert into public.icash_closing_setup(account_id,deal_id,payout) values($1,$2,$3)',[c.account,c.deal,{...payout,detailsSharedWithTitle:false}]);
  task=(await db.query("insert into public.icash_title_tasks(account_id,deal_id,request_id,source_key,kind,label,state,email_state,payload) values($1,$2,$3,$4,'document_update','Send title update','scheduled','issued',$5) returning *",[c.account,c.deal,c.request,'fixture-title-delivery-'+randomUUID(),kind==='payout'?{type:'payout',payout}:{type:'assignment',envelopeId:c.assignment}])).rows[0];
 }
 const snapshot=(await db.query('select public.icash_title_task_delivery_snapshot($1,$2) value',[c.account,task.id])).rows[0].value;
 return {...c,task,snapshot};
}
export const claimTitleTask=(db,c)=>c.task.kind==='follow_up'
 ?db.query("select public.icash_claim_title_followup($1,$2,'title-task-delivery-v1') value",[c.account,c.task.id])
 :db.query('select public.icash_claim_title_update($1,$2,$3,$4) value',[c.account,c.task.id,c.task.payload,c.snapshot]);
export const finishTitleTask=(db,c,receipt='fixture-original')=>db.query('select public.icash_finish_title_task_delivery($1,$2,$3) value',[c.account,c.task.id,receipt]);

export async function installTitleDeadlineSeed(db){
 const seed=JSON.parse(readFileSync('tests/fixtures/title-deadline-seed-predecessor.json','utf8'))[0];
 await db.exec(seed.definition);
 await db.exec('revoke all on function public.icash_seed_contract_deadlines(uuid) from public,anon,authenticated;grant execute on function public.icash_seed_contract_deadlines(uuid) to service_role;');
}
export async function cancelledTitleDeadlines(db){
 const account=randomUUID(),deal=randomUUID(),purchase=randomUUID();
 await db.query('insert into public.icash_accounts(id,owner_user_id) values($1,$2)',[account,randomUUID()]);
 await db.query('insert into public.icash_screening_jobs values($1,$2,$3)',[deal,account,{propertyId:'fictional-deadline-property'}]);
 await db.query("insert into public.icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$1,'under_contract',$3)",[deal,account,{address:'Fictional deadline property',closingDate:'2026-12-15'}]);
 await db.query("insert into public.icash_signing_envelopes(id,account_id,deal_id,kind,state,provider_id) values($1,$2,$3,'purchase','completed','101')",[purchase,account,deal]);
 await db.query('select public.icash_seed_contract_deadlines($1)',[purchase]);
 await db.query("update public.icash_title_tasks set state='cancelled' where account_id=$1",[account]);
 const tasks=(await db.query('select * from public.icash_title_tasks where account_id=$1 order by id',[account])).rows;
 return {account,deal,purchase,tasks};
}
