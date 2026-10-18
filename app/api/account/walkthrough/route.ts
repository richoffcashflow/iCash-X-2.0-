import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {allowedOrigin} from '@/lib/funding-policy';
import {limitRequest} from '@/lib/funding';
import {readCourseProgress} from '@/lib/course-progress-server';
import {walkthroughInput,walkthroughState,walkthroughVersion} from '@/lib/workspace-walkthrough';
const headers={'Cache-Control':'private, no-store'};
export const runtime='nodejs';
function failure(error:unknown){
 const code=error instanceof Error?error.message:'';
 const status=code==='SIGN_IN_REQUIRED'?401:['ACCOUNT_REQUIRED','SUBSCRIPTION_REQUIRED'].includes(code)?403:error instanceof Error&&'status' in error&&error.status===429?429:503;
 return Response.json({error:status===401?'Sign in to open your walkthrough.':status===403?'Open your active workspace to continue.':status===429?'Please wait a moment and try again.':'Your walkthrough progress could not be saved. Please try again.'},{status,headers});
}
export async function GET(){
 try{
  const {accountId}=await workAccount({allowUnacknowledged:true});
  const [rows,course]=await Promise.all([
   db<unknown[]>(`icash_workspace_walkthroughs?account_id=eq.${accountId}&version=eq.${walkthroughVersion}&select=step,state&limit=1`),
   readCourseProgress(accountId).catch(()=>null),
  ]);
  return Response.json({tour:walkthroughState.parse(rows[0]??{step:0,state:'new'}),course},{headers});
 }catch(error){return failure(error);}
}
export async function POST(req:Request){
 try{
  if(!allowedOrigin(req))return Response.json({error:'Open iCash X directly and try again.'},{status:403,headers});
  const {accountId,userId}=await workAccount({allowUnacknowledged:true});
  const raw=await req.text();if(raw.length>256)return Response.json({error:'Invalid walkthrough progress.'},{status:400,headers});
  let value:unknown;try{value=JSON.parse(raw);}catch{return Response.json({error:'Invalid walkthrough progress.'},{status:400,headers});}
  const parsed=walkthroughInput.safeParse(value);if(!parsed.success)return Response.json({error:'Invalid walkthrough progress.'},{status:400,headers});
  await limitRequest(req,'workspace-walkthrough',accountId,40,60);
  const tour=walkthroughState.parse(await db('rpc/icash_save_workspace_walkthrough','POST',{p_account:accountId,p_user:userId,p_step:parsed.data.step,p_state:parsed.data.state}));
  return Response.json({tour},{headers});
 }catch(error){return failure(error);}
}
