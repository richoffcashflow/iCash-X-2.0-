import {createHmac,timingSafeEqual} from 'node:crypto';
const audience='icash-workspace-revisions-v1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const signature=(body:string,key:string)=>createHmac('sha256',key).update(`${audience}\n${body}`).digest('base64url');
export function mintWorkspaceEventToken(accountId:string,key:string,now=Date.now()){
 if(!uuid.test(accountId)||key.length<20)throw Error('Event feed unavailable');
 const expiresAt=now+5*60*1000;
 const body=Buffer.from(JSON.stringify({aud:audience,sub:accountId,iat:now,exp:expiresAt})).toString('base64url');
 return {token:`${body}.${signature(body,key)}`,expiresAt};
}
/** This token grants only revision notifications, never database/API access. */
export function readWorkspaceEventToken(token:string,key:string,now=Date.now()):{accountId:string;expiresAt:number}|null{
 try{
  if(!key||key.length<20||token.length>1024)return null;
  const parts=token.split('.');if(parts.length!==2||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))return null;
  const expected=Buffer.from(signature(parts[0],key)),given=Buffer.from(parts[1]);
  if(given.length!==expected.length||!timingSafeEqual(given,expected))return null;
  const p=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
  if(p.aud!==audience||!uuid.test(p.sub)||!Number.isSafeInteger(p.exp)||!Number.isSafeInteger(p.iat)||p.iat>now||p.exp<=now||p.exp-p.iat!==300000)return null;
  return {accountId:p.sub,expiresAt:p.exp};
 }catch{return null;}
}
