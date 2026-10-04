import {createHmac,timingSafeEqual} from 'node:crypto';
type Purpose='visitor'|'resume'|'unsubscribe';
export function signWebinarToken(id:string,purpose:Purpose,seconds:number,key:string,now=Date.now()){
 const payload=Buffer.from(JSON.stringify({id,purpose,exp:Math.floor(now/1000)+seconds})).toString('base64url');
 return `${payload}.${createHmac('sha256',key).update(payload).digest('base64url')}`;
}
export function readWebinarToken(token:string|undefined,purpose:Purpose,key:string,now=Date.now()):string|null{
 if(!token||token.length>600)return null;const [payload,sig,...extra]=token.split('.');if(!payload||!sig||extra.length)return null;
 const expected=createHmac('sha256',key).update(payload).digest('base64url');if(sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
 try{const v=JSON.parse(Buffer.from(payload,'base64url').toString());return v.purpose===purpose&&Number.isSafeInteger(v.exp)&&v.exp>now/1000&&typeof v.id==='string'&&/^[0-9a-f-]{36}$/.test(v.id)?v.id:null;}catch{return null;}
}
