import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
process.env.ICASH_AUTH_EMAIL_READY='true';
for(const status of [429,503]){
 const {POST}=await loadService('app/api/auth/email/route.ts',{accountMode:()=> 'live',NextResponse:{json:Response.json},allowedOrigin:()=>true,normalizeEmail:s=>s,limitRequest:async()=>{},authRequest:async()=>{throw Object.assign(Error('Private provider failure'),{status});},db:async()=>true});
 const response=await POST(new Request('https://example.invalid/api/auth/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'fixture@example.invalid'})}));
 assert.equal(response.status,status);const body=await response.json();
 assert.doesNotMatch(body.error,/phone|sms|text|Private provider/);assert.match(body.error,/code.*(?:inbox|received)|inbox/i);
 if(status===429)assert.equal(response.headers.get('Retry-After'),'600');else assert.match(body.error,/support/);
}
console.log('PASS email rate limit and delivery error retain email recovery without disabled SMS fallback. No real OTP.');
