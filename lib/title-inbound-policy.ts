import {createHmac,timingSafeEqual} from 'node:crypto';
export function verifyTitleWebhook(body:string,headers:Headers,secret:string,now=Date.now()){
 const id=headers.get('svix-id')??'',stamp=headers.get('svix-timestamp')??'',signature=headers.get('svix-signature')??'';
 if(!secret.startsWith('whsec_')||!id||id.length>200||!/^\d+$/.test(stamp)||Math.abs(now/1000-Number(stamp))>300||signature.length>2000)throw Error('Invalid signature');
 const key=Buffer.from(secret.slice(6),'base64');if(key.length<16)throw Error('Invalid secret');
 const expected=createHmac('sha256',key).update(`${id}.${stamp}.${body}`).digest();
 if(!signature.split(' ').some(part=>{if(!part.startsWith('v1,'))return false;const got=Buffer.from(part.slice(3),'base64');return got.length===expected.length&&timingSafeEqual(got,expected);}))throw Error('Invalid signature');
 return JSON.parse(body);
}
export function titleEmailAddress(value:unknown){
 if(typeof value!=='string'||value.length>320||/[\r\n]/.test(value))return '';
 const address=(value.match(/<([^<>]+)>$/)?.[1]??value).trim().toLowerCase();
 return /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/.test(address)?address:'';
}
export function titleReference(subject:unknown){
 if(typeof subject!=='string')return null;
 const refs=[...subject.matchAll(/\[ICX-([TQM]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi)];
 return refs.length===1?{kind:refs[0][1].toUpperCase(),id:refs[0][2].toLowerCase()}:null;
}
