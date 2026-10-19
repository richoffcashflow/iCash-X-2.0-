type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Dispatch=(account:string,id:string)=>Promise<{status:string}>;
/** One saved opening for an assigned seller email opt-in. The ordinary email
 * claim owns current permission, spend and provider idempotency. */
export async function processSellerEmails({db,dispatch,configured,env=process.env}:{db:Database;dispatch:Dispatch;configured:()=>boolean;env?:NodeJS.ProcessEnv}){
 if(env.VERCEL_ENV!=='production'||env.ICASH_LIVE_WORK_READY!=='true')return {status:'disabled',accepted:0};
 if(!configured())return {status:'seller_email_configuration_required',accepted:0};
 const jobs=await db<{account_id:string;email_id:string}[]>('rpc/icash_queue_seller_emails','POST',{p_limit:10});
 let accepted=0,held=0,cursor=0;
 await Promise.all(Array.from({length:Math.min(3,jobs.length)},async()=>{
  while(cursor<jobs.length){const job=jobs[cursor++];try{if((await dispatch(job.account_id,job.email_id)).status==='email_accepted')accepted++;else held++;}catch{held++;}}
 }));
 return {status:jobs.length?'seller_emails_processed':'seller_emails_idle',accepted,held};
}
