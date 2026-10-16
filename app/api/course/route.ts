import {courseAccess,courseAssets,courseError,courseHeaders} from '@/lib/course-server';
import {requireDashboardPassword} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {db} from '@/lib/stripe-test';
export async function GET(){try{
 const {accountId,userId}=await courseAccess();const owner=userId===ownerInboundTarget.ownerUserId;
 const [assets,access]=await Promise.all([courseAssets(),db<{vip:boolean;vipFeatures:boolean}>('rpc/icash_workspace_vip_access','POST',{p_account:accountId})]);
 let canUpload=false;if(owner){try{await requireDashboardPassword(userId);canUpload=true;}catch(e){if(!(e instanceof Error)||e.message!=='DASHBOARD_PASSWORD_REQUIRED')throw e;}}
 return Response.json({owner,canUpload,vip:access.vipFeatures,assets:Object.fromEntries(['video','pdf'].map(kind=>{const asset=assets.find(a=>a.kind===kind);if(!asset)throw Error('Course configuration unavailable');return [kind,{ready:!!asset.path,name:asset.name,revision:asset.revision}];}))},{headers:courseHeaders});
 }catch(e){return courseError(e);}}
