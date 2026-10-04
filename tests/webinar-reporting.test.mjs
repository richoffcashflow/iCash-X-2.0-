import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {reportQuery,dailyCloseRate,emptyFunnel} from '../lib/webinar-reporting.ts';
test('daily reporting defaults to the business day and validates filters',()=>{
 assert.deepEqual(reportQuery.parse({}),{period:'today',timezone:'America/Chicago'});
 for(const period of ['today','yesterday','7d','30d'])assert.equal(reportQuery.parse({period,timezone:'America/New_York'}).period,period);
 for(const input of [{period:'all'},{timezone:'made-up'},{period:'today',accountId:'other'}])assert.equal(reportQuery.safeParse(input).success,false);
 assert.equal(dailyCloseRate(emptyFunnel),'—');assert.equal(dailyCloseRate({...emptyFunnel,viewers:4,buyers:6,cohortBuyers:1}),'25.0%','Earlier viewers who purchase today cannot inflate today’s close rate');
});
test('reports require owner authorization and return private results',async()=>{
 let owner=true;const calls=[];
 class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
 const deps={reportQuery,WebinarError,webinarOwner:async()=>{if(!owner)throw new WebinarError(403,'Owner required');},webinarHeaders:{'Cache-Control':'private, no-store'},webinarError:e=>Response.json({error:e.message},{status:e.status??503}),db:async(...args)=>{calls.push(args);return {summary:emptyFunnel};}};
 globalThis.__webinarReportRoute=deps;
 const source=ts.transpileModule(readFileSync(new URL('../app/api/webinar/reports/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 const route=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__webinarReportRoute;\n'+source).toString('base64'));
 const get=query=>route.GET(new Request('https://example.test/api/webinar/reports'+query));
 owner=false;assert.equal((await get('')).status,403);assert.equal(calls.length,0);owner=true;
 assert.equal((await get('?period=invalid')).status,400);assert.equal(calls.length,0);
 const response=await get('?period=yesterday&timezone=America%2FChicago');assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 assert.deepEqual(calls[0],['rpc/icash_webinar_daily_report','POST',{p_period:'yesterday',p_timezone:'America/Chicago'}]);
});
