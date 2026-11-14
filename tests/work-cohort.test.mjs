import assert from 'node:assert/strict';
import {createObservation,renderCohortQuery} from '../scripts/work-cohort.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const a={id:id(1),created_at:'2026-11-01T00:00:00Z',membership_allowed:true,acknowledged:true,bot_paused:false,
 enabled:true,auto_enabled:true,contacts_enabled:true,search_enabled:true,contact_enabled:true,
 data_rights_until:'2026-12-01T00:00:00Z',search_expires:'2026-12-01T00:00:00Z',contact_expires:'2026-12-01T00:00:00Z',
 prospecting_available_cents:210,search_minimum:300,contact_minimum:100,operations:{pending:9},
 research_receipts:[],text_receipts:[{id:'original-message',state:'accepted',providerId:'original-provider',createdAt:'2026-11-14T13:00:00Z'}]};
const baseline={cohortId:'synthetic-fixed-cohort',accounts:[a,{id:id(2)}]},rows=[{observed_at:'2026-11-14 14:00:00.123456+00',evidence:a}];
const first=createObservation(baseline,rows);
assert.equal(first.payload.counts.enrolled,2);assert.equal(first.payload.counts.unknown,1);
assert.equal(first.payload.counts.needs_investigation,1);assert.equal(first.payload.counts.textAccepted24h,1);assert.equal(first.payload.counts.textDelivered24h,0);
assert.equal(first.payload.continuousZeroStallStreak,null);assert.equal(first.payload.provenPreventableStalls,null);
const second=createObservation(baseline,[{observed_at:'2026-11-14T15:00:00Z',evidence:{...a,monitor_reason:null,control_action:'resume',control_at:'2026-11-14T15:00:00Z',last_funded_at:'2026-11-14T15:00:00Z'}}],first);
assert.equal(second.payload.counts.recent_completed_work,0,'Funding/resume/cleared alert/reconciliation are never original outputs');
const third=createObservation(baseline,[{observed_at:'2026-11-14T18:00:00Z',evidence:{...a,research_receipts:[{id:'original-search',createdAt:'2026-11-14T17:50:00Z'}],text_receipts:[{...a.text_receipts[0],state:'delivered',deliveryAt:'2026-11-14T17:45:00Z'}]}}],second);
assert.equal(third.payload.observationGap,true);assert.equal(third.payload.counts.recent_completed_work,1);assert.equal(third.payload.counts.textDelivered24h,1);
assert.equal(third.payload.continuousZeroStallStreak,null,'Late recovery cannot erase the earlier unknown or missing observations');
assert.throws(()=>createObservation(baseline,rows,third),/NOT_FORWARD/);
assert.throws(()=>createObservation({...baseline,accounts:[a]},rows,first),/HISTORY_CHANGED/);
assert.throws(()=>createObservation(baseline,[...rows,...rows]),/MEMBERSHIP_MISMATCH/);
assert.throws(()=>createObservation(baseline,rows,{...first,payload:{...first.payload,counts:{}}}),/HISTORY_CHANGED/);
const query=renderCohortQuery(baseline);assert(query.includes('begin read only;'));assert(!query.includes('__ICASH_COHORT_IDS__'));assert(!query.includes('where w.balance_cents>0'));
assert(query.includes("set local statement_timeout='20s';"),'Every rendered production observation has a bounded read timeout');
console.log('PASS fixed cohort: departed/missing members retained, original output IDs, accepted vs delivered, no funding/resume/alert credit, hash-linked history, missing periods and explicit unknowns.');
