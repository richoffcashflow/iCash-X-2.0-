import {db} from '@/lib/stripe-test';
import {fundingEnabled,fundingMode} from '@/lib/funding-policy';
import {evaluateLaunch,type LaunchChecks} from './launch-readiness-policy.ts';
export async function launchReadiness(accountId:string|null=null){
 try{
 const checks=await db<LaunchChecks>('rpc/icash_launch_checks','POST',{p_account:accountId});
 return evaluateLaunch(checks,{data:!!process.env.DEALMACHINE_API_KEY,voice:!!process.env.ELEVENLABS_API_KEY,email:process.env.ICASH_AUTH_EMAIL_READY==='true',billing:fundingEnabled()&&process.env.ICASH_DAILY_BILLING_READY==='true'&&!!process.env.CRON_SECRET});
 }catch{return {ready:false,acquisitionReady:false,blockers:['readiness_unavailable']};}
}
/** Sandbox checkout stays available for verification without enabling live work. */
export async function liveFundingReady(){
 if(!fundingEnabled())return false;
 return fundingMode()==='test'||(await launchReadiness()).ready;
}
