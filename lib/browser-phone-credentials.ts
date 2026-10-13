import {createHash,createHmac,createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
export type BrowserPhoneCredentials={provider_account_sid:string;api_key_sid:string;secret_ciphertext:string;state:string};
const key=(secret:string)=>{if(secret.length<16)throw Error('BROWSER_PHONE_SETUP_REQUIRED');return createHash('sha256').update('icash-browser-voice-v1\0'+secret).digest();};
export function sealBrowserPhoneSecret(value:string,secret:string){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);
 const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return [iv,cipher.getAuthTag(),encrypted].map(b=>b.toString('base64url')).join('.');
}
export function openBrowserPhoneSecret(value:string,secret:string){
 const [iv,tag,encrypted]=value.split('.').map(s=>Buffer.from(s,'base64url'));
 const cipher=createDecipheriv('aes-256-gcm',key(secret),iv);cipher.setAuthTag(tag);
 return Buffer.concat([cipher.update(encrypted),cipher.final()]).toString('utf8');
}
export function browserPhoneIdentity(accountId:string,userId:string,requestKey:string){
 return 'icash_'+createHash('sha256').update([accountId,userId,requestKey].join('\0')).digest('hex');
}
/** Receive only on this attempt's unguessable identity. No outgoing dialing grant. */
export function browserPhoneToken(config:BrowserPhoneCredentials,identity:string,env:NodeJS.ProcessEnv=process.env,now=Math.floor(Date.now()/1000)){
 if(config.state!=='ready'||config.provider_account_sid!==env.TWILIO_ACCOUNT_SID||!/^SK[0-9a-f]{32}$/i.test(config.api_key_sid)||!/^icash_[a-f0-9]{64}$/.test(identity))throw Error('BROWSER_PHONE_SETUP_REQUIRED');
 const secret=openBrowserPhoneSecret(config.secret_ciphertext,env.TWILIO_AUTH_TOKEN??'');
 const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const body=encode({typ:'JWT',alg:'HS256',cty:'twilio-fpa;v=1'})+'.'+encode({jti:config.api_key_sid+'-'+randomUUID(),iss:config.api_key_sid,sub:config.provider_account_sid,iat:now,nbf:now-5,exp:now+900,grants:{identity,voice:{incoming:{allow:true}}}});
 return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
}
