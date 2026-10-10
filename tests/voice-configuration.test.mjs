import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {ownVoiceConsentVersion,maxVoiceSampleBytes} from '../lib/custom-voice-policy.ts';
let signedIn=true,origin=true,vip=true,enabled=false,calls=[],uploads=0;
const status=()=>({state:'ready',vip,enabled:enabled&&vip});
const route=await loadService('app/api/account/custom-voice/route.ts',{
 NextResponse:{json:Response.json},allowedOrigin:()=>origin,ownVoiceConsentVersion,maxVoiceSampleBytes,limitRequest:async()=>{},
 workAccount:async()=>{if(!signedIn)throw Error('Sign in required');return {accountId:'current-account',userId:'current-user'};},
 customVoiceStatus:async account=>{assert.equal(account,'current-account');return status();},
 createCustomVoice:async(account,user,bytes,consent)=>{assert.equal(account,'current-account');assert.equal(user,'current-user');assert.equal(consent,ownVoiceConsentVersion);assert.equal(bytes.length,1500);uploads++;enabled=true;return status();},
 db:async(path,method,body)=>{calls.push({path,method,body});if(path==='rpc/icash_vip_active')return vip;if(path==='rpc/icash_set_custom_voice_enabled'){assert.equal(body.p_account,'current-account');assert.equal(body.p_user,'current-user');if(body.p_enabled&&!vip)throw Error('VIP required');enabled=body.p_enabled;return;}throw Error(path);}
});
const patch=body=>route.PATCH(new Request('https://www.geticashx.com/api/account/custom-voice',{method:'PATCH',body:JSON.stringify(body)}));
const upload=async(size=1500,consent=ownVoiceConsentVersion)=>{const form=new FormData();form.set('sample',new File([new Uint8Array(size)],'own-recording.mp3',{type:'audio/mpeg'}));form.set('consent',consent);const encoded=new Request('https://www.geticashx.com/api/account/custom-voice',{method:'POST',body:form});return route.POST(new Request(encoded.url,{method:'POST',headers:encoded.headers,body:await encoded.arrayBuffer()}));};
let r=await route.GET();assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(uploads,0,'Loading settings never creates or synthesizes a voice');
r=await upload();assert.equal(r.status,200);assert.equal((await r.json()).enabled,true);assert.equal(uploads,1);
assert.equal((await patch({enabled:false})).status,200);assert.equal((await (await route.GET()).json()).enabled,false,'Saved standard-voice toggle survives reload');
assert.equal((await patch({enabled:true})).status,200);assert.equal((await (await route.GET()).json()).enabled,true);
const before=calls.length;for(const body of [{enabled:'true'},{enabled:true,accountId:'other'},{voiceId:'arbitrary'}])assert.equal((await patch(body)).status,409);assert.equal(calls.length,before);
vip=false;assert.equal((await upload()).status,403);assert.equal((await patch({enabled:true})).status,409);assert.equal((await patch({enabled:false})).status,200,'An expired VIP can always disable their own custom voice');assert.equal(uploads,1);
vip=true;assert.equal((await upload(1500,'unaccepted')).status,409);assert.equal((await upload(maxVoiceSampleBytes+32769)).status,409);assert.equal(uploads,1);
origin=false;assert.equal((await patch({enabled:true})).status,403);assert.equal((await upload()).status,403);origin=true;signedIn=false;assert.equal((await route.GET()).status,401);assert.equal((await upload()).status,409);assert.equal(uploads,1);
console.log('PASS voice configuration API: account-bound save/reload, custom/standard toggle, VIP expiry, consent, oversized upload, origin/auth checks and no upload on a read. Provider calls mocked.');
