import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {readDealLearningReport} from '@/lib/deal-learning-report';
export const dynamic='force-dynamic';
export async function GET(){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const {accountId}=await workAccount();
  return Response.json(await readDealLearningReport(db,accountId),{headers});
 }catch{return Response.json({error:'Could not load outcome evidence. Please retry.'},{status:503,headers});}
}
