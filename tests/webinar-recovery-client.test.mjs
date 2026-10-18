import test from 'node:test';
import assert from 'node:assert/strict';
import {installWebinarRecovery} from '../lib/webinar-recovery-client.ts';

test('visibility, bfcache and pagehide produce one departure and a newer return; checkout is not abandonment',()=>{
 const doc=new EventTarget(),win=new EventTarget(),sent=[];doc.hidden=false;
 globalThis.document=doc;globalThis.window=win;let eligible=true;
 const recovery=installWebinarRecovery('session',()=>eligible,signal=>sent.push(signal));
 assert.equal(sent.at(-1).state,'active');
 win.dispatchEvent(new Event('beforeunload'));assert.equal(sent.length,1,'Stay/canceled navigation sends nothing');
 doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));win.dispatchEvent(new Event('pagehide'));
 assert.deepEqual(sent.map(s=>s.state),['active','left']);
 doc.hidden=false;win.dispatchEvent(new Event('pageshow'));doc.dispatchEvent(new Event('visibilitychange'));
 assert.deepEqual(sent.map(s=>s.state),['active','left','active']);assert.equal(new Set(sent.map(s=>s.pageId)).size,1);
 assert.deepEqual(sent.map(s=>s.sequence),[1,2,3]);
 eligible=false;recovery.sync();doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(sent.at(-1).state,'checkout');assert.equal(sent.length,4);
 recovery.stop();win.dispatchEvent(new Event('pagehide'));assert.equal(sent.length,4);
});

test('a background tab does not depart before it has ever become visible',()=>{
 const doc=new EventTarget(),win=new EventTarget(),sent=[];doc.hidden=true;globalThis.document=doc;globalThis.window=win;
 const recovery=installWebinarRecovery('session',()=>true,s=>sent.push(s));win.dispatchEvent(new Event('pagehide'));assert.equal(sent.length,0);
 doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(sent.at(-1).state,'active');recovery.stop();
});

test('client-side Back or navigation unmounts signal departure without pagehide; remount reports a fresh active page',()=>{
 const doc=new EventTarget(),win=new EventTarget(),sent=[];doc.hidden=false;globalThis.document=doc;globalThis.window=win;
 const first=installWebinarRecovery('session',()=>true,s=>sent.push(s));first.stop();
 assert.deepEqual(sent.map(s=>s.state),['active','left']);
 const next=installWebinarRecovery('session',()=>true,s=>sent.push(s));assert.equal(sent.at(-1).state,'active');assert.notEqual(sent[0].pageId,sent.at(-1).pageId);next.stop();
});
