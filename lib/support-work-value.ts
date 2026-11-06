import {db} from '@/lib/stripe-test';
import {opportunityPeriod,readOpportunityProgress} from '@/lib/opportunity-progress-read';
import {supportValueSummary,validWorkValue} from './work-value';
import type {SupportEvidence} from './support-policy';

export async function supportWorkValue(accountId:string,question:string|null,zone:string|null):Promise<SupportEvidence|null>{
 // Operator inspection may always read the receipt. Only a matched customer
 // question can place the receipt in an automated reply.
 if(question!==null){
  const matches=await db<unknown>('rpc/icash_value_question','POST',{p_question:question},AbortSignal.timeout(2200)).catch(()=>false);
  if(matches!==true)return null;
 }
 const timezone=opportunityPeriod(new URLSearchParams({timezone:zone||'America/Chicago'}))?.timezone??'America/Chicago';
 const base={key:'work_value',source:'icash_opportunity_progress_report',observedAt:new Date().toISOString()};
 try{
  const progress=await readOpportunityProgress(accountId,1,timezone,AbortSignal.timeout(6500));
  if(!validWorkValue(progress.receipt))throw Error('Receipt unavailable');
  return {...base,status:'ok',code:'work_receipt_checked',detail:supportValueSummary(progress,progress.receipt)};
 }catch{return {...base,status:'unknown',code:'work_receipt_pending',detail:'I can’t verify today’s credit usage and seller outcomes yet.'};}
}
