import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {reportQuery,dailyCloseRate,emptyFunnel,validWebinarReport} from '../lib/webinar-reporting.ts';
import {webinarFunnelStages} from '../lib/conversion-funnel.ts';
test('daily reporting defaults to the business day and validates filters',()=>{
 assert.deepEqual(reportQuery.parse({}),{period:'today',timezone:'America/Chicago'});
 for(const period of ['today','yesterday','7d','30d'])assert.equal(reportQuery.parse({period,timezone:'America/New_York'}).period,period);
 for(const input of [{period:'all'},{timezone:'made-up'},{period:'today',accountId:'other'}])assert.equal(reportQuery.safeParse(input).success,false);
 assert.equal(dailyCloseRate(emptyFunnel),'—');assert.equal(dailyCloseRate({...emptyFunnel,viewers:4,buyers:6,cohortBuyers:1}),'25.0%','Earlier viewers who purchase today cannot inflate today’s close rate');
});
test('reports require owner authorization and return private results',async()=>{
 let owner=true,bad=false;const calls=[];
 class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
 const deps={reportQuery,validWebinarReport,WebinarError,webinarOwner:async()=>{if(!owner)throw new WebinarError(403,'Owner required');},webinarHeaders:{'Cache-Control':'private, no-store'},webinarError:e=>Response.json({error:e.message},{status:e.status??503}),db:async(...args)=>{calls.push(args);return bad?{summary:emptyFunnel}:{period:args[2].p_period,timezone:args[2].p_timezone,startDate:'2026-10-09',endDate:'2026-10-09',startsAt:'2026-10-09T05:00:00Z',endsAt:'2026-10-10T05:00:00Z',generatedAt:'2026-10-10T12:00:00Z',summary:emptyFunnel,webinars:[],recordings:[],days:[],conversionFunnel:{summary:webinarFunnelStages.map(s=>({key:s.key,count:0})),webinars:[]}};}};
 globalThis.__webinarReportRoute=deps;
 const source=ts.transpileModule(readFileSync(new URL('../app/api/webinar/reports/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 const route=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__webinarReportRoute;\n'+source).toString('base64'));
 const get=query=>route.GET(new Request('https://example.test/api/webinar/reports'+query));
 owner=false;assert.equal((await get('')).status,403);assert.equal(calls.length,0);owner=true;
 assert.equal((await get('?period=invalid')).status,400);assert.equal(calls.length,0);
 const response=await get('?period=yesterday&timezone=America%2FChicago');assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 assert.deepEqual(calls[0].slice(0,3),['rpc/icash_webinar_report_with_funnel','POST',{p_period:'yesterday',p_timezone:'America/Chicago'}]);assert(calls[0][3] instanceof AbortSignal);
 bad=true;assert.equal((await get('')).status,503,'Missing funnel is unavailable, never zero');
});
