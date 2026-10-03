import {contractCapability} from './contract-coverage.ts';
import {readContractCoverage} from './contract-coverage-service';
import {db} from '@/lib/stripe-test';
import {earlyAccessFundingEnabled,fundingEnabled,fundingMode} from '@/lib/funding-policy';
import {evaluateLaunch,type LaunchChecks} from './launch-readiness-policy.ts';
export async function launchReadiness(accountId:string|null=null){
 try{
 const [checks,contractCoverage,markets,configs]=await Promise.all([
 db<LaunchChecks>('rpc/icash_launch_checks','POST',{p_account:accountId}),readContractCoverage(),
 db<{zip:string;state:string}[]>('icash_market_shortlist?select=zip,state&limit=1001'),
 db<{zip:string}[]>(`icash_discovery_configs?enabled=eq.true${accountId?`&account_id=eq.${accountId}`:''}&select=zip&limit=1001`)
 ]);
 const covered=markets.length<=1000&&configs.length>0&&configs.length<=1000&&configs.every(c=>{const market=markets.find(m=>m.zip===c.zip);return market&&contractCapability(contractCoverage,market.state,1).supported;});
 checks.productionContracts=checks.productionContracts&&covered;
 return {...evaluateLaunch(checks,{data:!!process.env.DEALMACHINE_API_KEY,voice:!!process.env.ELEVENLABS_API_KEY,email:process.env.ICASH_AUTH_EMAIL_READY==='true',billing:fundingEnabled()&&process.env.ICASH_DAILY_BILLING_READY==='true'&&!!process.env.CRON_SECRET}),contractCoverage};
 }catch{return {ready:false,acquisitionReady:false,blockers:['readiness_unavailable']};}
}
/** Sandbox checkout stays available for verification without enabling live work. */
export async function liveFundingReady(){
 if(!fundingEnabled())return false;
 return fundingMode()==='test'||(await launchReadiness()).ready;
}
/** Payment checkout readiness only; does not represent live-work readiness. */
export async function customerFundingReady(){
 return earlyAccessFundingEnabled()||await liveFundingReady();
}
