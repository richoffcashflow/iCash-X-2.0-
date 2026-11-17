import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {titleReplyOriginalSource} from '../lib/title-reply-source.ts';
const text='Please send the executed purchase agreement.';
const expected=createHash('sha256').update(text).digest('hex');
assert.deepEqual(titleReplyOriginalSource({created_at:'2026-11-16T10:11:12.123456Z',text},'fixture-event'),{providerReceivedAt:'2026-11-16T10:11:12.123Z',webhookEventId:'fixture-event',bodyComplete:true,bodySha256:expected});
for(const created_at of [undefined,null,'yesterday','2026-11-16','not-a-date','2026-02-30T10:11:12Z','2026-11-16T24:00:00Z'])assert.equal(titleReplyOriginalSource({created_at,text},'event').providerReceivedAt,null);
for(const value of [undefined,null,{},text+' '.repeat(20000)]){const source=titleReplyOriginalSource({created_at:'2026-11-16T10:11:12Z',text:value},'event');assert.equal(source.bodyComplete,false);assert.equal(source.bodySha256,null);}
assert.equal(titleReplyOriginalSource({text:'x'.repeat(20000)},'event').bodyComplete,true);
assert.equal(titleReplyOriginalSource({text},'x'.repeat(201)).webhookEventId,null);
console.log('PASS title original source: authenticated-provider timestamp only, complete raw body fingerprint, no retry-time fallback or capped-body authority.');
