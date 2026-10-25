import assert from 'node:assert/strict';
import {syncResearchExclusions} from '../lib/research-exclusions.ts';
process.env.DEALMACHINE_API_KEY='dm_sk_live_LOCAL_FIXTURE';
const token='00000000-0000-4000-8000-000000000001',name='research-exclusions-'+token;
let claim={action:'create',token,name,listId:null,ids:[]},writes=[],calls=[],allowed=true,timeout=false;
const db=async(path,method,body)=>{
 if(path==='rpc/icash_claim_research_exclusions')return claim;
 if(path==='rpc/icash_take_dealmachine_request')return allowed;
 if(path==='rpc/icash_finish_dealmachine_request')return true;
 assert.equal(path,'rpc/icash_finish_research_exclusions');writes.push(body);return true;
};
const fetch=async(url,init)=>{
 calls.push({url,init});assert.equal(init.redirect,'error');if(timeout)throw Error('timeout');
 if(claim.action==='sync'){assert.deepEqual(JSON.parse(init.body),{ids:['prop_1'],id_type:'internal_property_id',add_as_prospects:false});return Response.json({data:{added:0}});}
 const data={list_id:'fixture-list',name,source_type:'properties',status:'completed'};
 if(claim.action==='recover'){assert.equal(init.method,'GET');assert.equal(init.body,undefined);return Response.json({data:[data]});}
 assert.deepEqual(JSON.parse(init.body),{name,source_type:'properties',add_as_prospects:false});return Response.json({data});
};
allowed=false;assert.equal((await syncResearchExclusions(db,fetch)).status,'pending');assert.equal(calls.length,0);assert.equal(writes.at(-1).p_result.unstarted,true);
allowed=true;timeout=true;await syncResearchExclusions(db,fetch);assert.equal(calls.length,1);assert.equal(writes.at(-1).p_result.unstarted,false);
timeout=false;claim={...claim,action:'recover'};assert.equal((await syncResearchExclusions(db,fetch)).status,'synced');assert.equal(calls.at(-1).init.method,'GET');
claim={...claim,action:'sync',listId:'fixture-list',ids:['prop_1']};assert.equal((await syncResearchExclusions(db,fetch)).status,'synced');assert.deepEqual(writes.at(-1).p_result.ids,['prop_1']);
claim=null;assert.equal((await syncResearchExclusions(db,fetch)).status,'not_due');
console.log('Exclusions: free list metadata, exact identity, proven-unstarted quota deferral, unknown-create recovery and idempotent add passed.');
