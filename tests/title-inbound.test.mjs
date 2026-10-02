import assert from 'node:assert/strict';
import {randomBytes,webcrypto} from 'node:crypto';
import {verifyTitleWebhook,titleEmailAddress,titleReference} from '../lib/title-inbound-policy.ts';
// Protocol/provenance: https://docs.svix.com/receiving/verifying-payloads/how-manual#example-signatures
// The former fixed fixture was Svix's public example, not a production credential.
// Generate an ephemeral, test-only key; never send or persist it. WebCrypto signs
// independently of the production verifier's createHmac implementation.
const keyBytes=randomBytes(32);
const signingKey=await webcrypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
const body='{"event_type":"ping","data":{"success":true}}';
const id='msg_test_only_title_inbound',stamp='1731705121';
const signedContent=new TextEncoder().encode(`${id}.${stamp}.${body}`);
const signature=Buffer.from(await webcrypto.subtle.sign('HMAC',signingKey,signedContent)).toString('base64');
const h=new Headers({'svix-id':id,'svix-timestamp':stamp,'svix-signature':`v1,${signature}`});
const secret=`whsec_${keyBytes.toString('base64')}`;
assert.equal(verifyTitleWebhook(body,h,secret,1731705121000).event_type,'ping');
assert.throws(()=>verifyTitleWebhook(body+' ',h,secret,1731705121000));
assert.throws(()=>verifyTitleWebhook(body,h,secret,1731705521000));
assert.throws(()=>verifyTitleWebhook(body,h,secret,1731704721000));
const wrongSecret=`whsec_${randomBytes(32).toString('base64')}`;
assert.throws(()=>verifyTitleWebhook(body,h,wrongSecret,1731705121000));
const changedId=new Headers(h);changedId.set('svix-id','msg_test_only_tampered');
assert.throws(()=>verifyTitleWebhook(body,changedId,secret,1731705121000));
const changedStamp=new Headers(h);changedStamp.set('svix-timestamp','1731705122');
assert.throws(()=>verifyTitleWebhook(body,changedStamp,secret,1731705121000));
assert.equal(titleEmailAddress('Closer <OFFICE@example.com>'),'office@example.com');
assert.equal(titleEmailAddress('x@example.com\r\nBcc:y@example.com'),'');
const tag='[ICX-T:12345678-1234-1234-1234-123456789abc]';
assert.equal(titleReference('Re: '+tag).kind,'T');assert.equal(titleReference(tag+tag),null);assert.equal(titleReference('reference fake'),null);
console.log('Independent test-only signature, tampering, replay window, address and thread isolation checks passed. No email sent.');
