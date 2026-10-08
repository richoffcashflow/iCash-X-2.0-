import type {MessagingDatabase} from './messaging-settings.ts';
type Result={status:string};
/** The two branches have separate failure boundaries and share durable DB send grants. */
export async function processMessaging({database,followups,customerUpdate,production}:{
 database:MessagingDatabase;followups:()=>Promise<unknown>;customerUpdate:(account:string)=>Promise<Result>;production:boolean;
}){
 if(!production)return {status:'disabled'};
 const customers=async()=>{
  let activated=0,activationFailed=false;
  try{activated=await database<number>('rpc/icash_webinar_activate_customers','POST',{});}catch{activationFailed=true;}
  const accounts=await database<string[]>('rpc/icash_messaging_due_customers','POST',{p_limit:50});
  let cursor=0,accepted=0,held=0;
  await Promise.all(Array.from({length:Math.min(4,accounts.length)},async()=>{
   while(cursor<accounts.length){const account=accounts[cursor++];try{const result=await customerUpdate(account);if(result.status==='updates_accepted')accepted++;if(result.status==='updates_needs_review')held++;}catch{held++;}}
  }));
  return {activated,activationFailed,checked:accounts.length,accepted,held};
 };
 const [customerResult,campaignResult]=await Promise.allSettled([customers(),followups()]);
 return {customers:customerResult.status==='fulfilled'?customerResult.value:{unavailable:true},campaign:campaignResult.status==='fulfilled'?campaignResult.value:{unavailable:true}};
}
