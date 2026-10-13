import {createHmac,timingSafeEqual} from 'node:crypto';

export const dashboardCookie='__Host-icash_dashboard';
export const dashboardLifetime=3600;
type Binding={sub:string;session_id:string};
// These claims only bind a signed proof. They never replace the Auth server's user verification.
export function dashboardBinding(access:string|undefined):Binding|null{
 try{if(!access||access.length>16384)return null;const p=JSON.parse(Buffer.from(access.split('.')[1],'base64url').toString());const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;return uuid.test(p.sub)&&uuid.test(p.session_id)?{sub:p.sub,session_id:p.session_id}:null;}catch{return null;}
}
function signature(body:string,key:string){return createHmac('sha256',key).update('icash-dashboard-password-v1:'+body).digest('base64url');}
export function issueDashboardProof(access:string,userId:string,key:string,now=Date.now()){
 const b=dashboardBinding(access);if(!b||b.sub!==userId||key.length<32)throw Error('Dashboard session unavailable');
 const body=Buffer.from(JSON.stringify({...b,expires:Math.floor(now/1000)+dashboardLifetime})).toString('base64url');
 return body+'.'+signature(body,key);
}
export function validDashboardProof(proof:string|undefined,access:string|undefined,key:string|undefined,userId?:string,now=Date.now()){
 try{
  if(!proof||proof.length>2048||!key||key.length<32)return false;
  const parts=proof.split('.');if(parts.length!==2||!/^[A-Za-z0-9_-]+$/.test(parts[0])||!/^[A-Za-z0-9_-]{43}$/.test(parts[1]))return false;
  if(!timingSafeEqual(Buffer.from(parts[1]),Buffer.from(signature(parts[0],key))))return false;
  const p=JSON.parse(Buffer.from(parts[0],'base64url').toString()),b=dashboardBinding(access),seconds=Math.floor(now/1000);
  return !!b&&p.sub===b.sub&&p.session_id===b.session_id&&(!userId||userId===p.sub)&&Number.isSafeInteger(p.expires)&&p.expires>seconds&&p.expires<=seconds+dashboardLifetime;
 }catch{return false;}
}
