import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {funnelRows,sellerFunnelStages,webinarFunnelStages,validFunnelSteps,validWebinarFunnels} from '../lib/conversion-funnel.ts';
import {ConversionFunnel} from './helpers/conversion-funnel.mjs';
const steps=values=>sellerFunnelStages.map((s,i)=>({key:s.key,count:values[i]}));
test('Drops use the prior stage while total conversion uses the starting cohort',()=>{
 const rows=funnelRows(steps([100,70,40,20,10,5]),sellerFunnelStages);
 assert.equal(rows[1].drop,30);assert.equal(rows[1].dropPercent,30);assert.equal(rows[2].dropPercent,42.9);assert.equal(rows[5].share,5);
 assert.equal(funnelRows(steps([0,0,0,0,0,0]),sellerFunnelStages)[5].share,null);
 for(const bad of [null,[],steps([1,2,1,0,0,0]),steps([1,.5,0,0,0,0]),steps([1,NaN,0,0,0,0]),steps([1,0,0,0,0,-1])])assert.equal(validFunnelSteps(bad,sellerFunnelStages),false);
 const summary=webinarFunnelStages.map(s=>({key:s.key,count:0}));
 assert.equal(validWebinarFunnels({summary,webinars:[{webinarId:'a',steps:summary},{webinarId:'a',steps:summary}]}),false);
 assert.equal(validWebinarFunnels({summary,webinars:[{webinarId:'a',steps:summary.map(s=>({...s,count:1}))}]}),false);
});
test('The visual exposes accessible counts and drop-off, honest loading and true zero without division errors',()=>{
 const props={title:'Lead to close',description:'The selected period',stages:sellerFunnelStages};
 let html=renderToStaticMarkup(ConversionFunnel({...props,steps:steps([100,70,40,20,10,5])}));
 for(const label of ['Lead to close','30 not advanced','42.9% drop-off','5 of 100 reached the final step','aria-label="Lead to close"'])assert(html.includes(label),label);
 assert.match(html,/<polygon points="0,0 100,0 85,32 15,32"/,'Width tracks actual proportions');
 html=renderToStaticMarkup(ConversionFunnel(props));assert(html.includes('Loading funnel'));assert(!html.includes('0%'));assert(!html.includes('<polygon'));
 html=renderToStaticMarkup(ConversionFunnel({...props,unavailable:true}));assert(html.includes('Funnel unavailable'));assert(!html.includes('Loading funnel'));
 html=renderToStaticMarkup(ConversionFunnel({...props,steps:steps([0,0,0,0,0,0])}));assert(html.includes('0 of 0'));assert(!html.includes('NaN'));assert(!html.includes('Infinity'));assert(!html.includes('<polygon'));
});
