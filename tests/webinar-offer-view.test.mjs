import assert from 'node:assert/strict';
import {test} from 'node:test';
import {observeWebinarOfferView} from '../lib/webinar-offer-view.ts';

function fixture(run){
 const originalDocument=globalThis.document,originalObserver=globalThis.IntersectionObserver;
 const listeners=new Map(),heading={},other={};let callback,observed=0,disconnected=0,views=0;
 globalThis.document={hidden:false,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 globalThis.IntersectionObserver=class{
  constructor(fn,options){callback=fn;assert.equal(options.threshold,0.5);}
  observe(node){assert.equal(node,heading);observed++;}
  unobserve(node){assert.equal(node,heading);}
  disconnect(){disconnected++;}
 };
 const stop=observeWebinarOfferView(heading,()=>views++);
 const expose=(intersectionRatio=1,target=heading)=>callback([{target,isIntersecting:intersectionRatio>0,intersectionRatio}]);
 try{run({stop,expose,other,listeners,get views(){return views;},get observed(){return observed;},get disconnected(){return disconnected;}});}
 finally{stop();if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;if(originalObserver===undefined)delete globalThis.IntersectionObserver;else globalThis.IntersectionObserver=originalObserver;}
}

test('offer exposure requires half the actual heading on screen and only reports once',()=>fixture(f=>{
 assert.equal(f.views,0,'Mounting an offer is not a view');
 f.expose(0);f.expose(0.49);f.expose(1,f.other);assert.equal(f.views,0);
 f.expose(0.5);assert.equal(f.views,1);assert.equal(f.disconnected,1);
 f.expose(1);assert.equal(f.views,1,'Repeated observer updates cannot duplicate the signal');
 assert.equal(f.listeners.size,0);
}));

test('background offers wait for a fresh visibility observation when the tab returns',()=>fixture(f=>{
 document.hidden=true;f.expose();assert.equal(f.views,0);
 document.hidden=false;f.listeners.get('visibilitychange')();
 assert.equal(f.observed,2);assert.equal(f.views,0,'A stale background observation cannot qualify on return');
 f.expose(0);assert.equal(f.views,0);f.expose();assert.equal(f.views,1);
}));

test('unmounts discard late observer callbacks',()=>fixture(f=>{
 f.stop();f.expose();assert.equal(f.views,0);assert.equal(f.listeners.size,0);
}));

test('unsupported visibility measurement does not fabricate an offer view',()=>{
 const original=globalThis.IntersectionObserver;let views=0;
 try{delete globalThis.IntersectionObserver;observeWebinarOfferView({},()=>views++)();assert.equal(views,0);}
 finally{if(original!==undefined)globalThis.IntersectionObserver=original;}
});
