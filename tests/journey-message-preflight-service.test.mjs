import assert from 'node:assert/strict';
import {TextClaimRefusedError} from '../lib/voice-budget-failure.ts';
import {PGlite} from '@electric-sql/pglite';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {api,setup,reset,applyMigration,ids} from './helpers/journey-message-preflight-fixture.mjs';
const pg=await PGlite.create(),{one,due,state}=api(pg);
globalThis.fetch=async()=>{throw Error('Network disabled for journey preflight services');};
try{
 await setup(pg);await applyMigration(pg);
 for(const hold of ['configuration','number_verification','final_admission','unknown_final_claim','unknown_provider']){
  await pg.exec(reset);
  let recovered=false,sends=0,claimCalls=0;
  const env={CONTIGUITY_API_KEY:'fixture-only',CONTIGUITY_WEBHOOK_SECRET:'fixture-only'};
  const db=async(path,method,body)=>{
   if(path==='rpc/icash_due_journeys')return [];
   if(path==='rpc/icash_claim_journey_message')return (await one('select icash_claim_journey_message() result')).result;
   if(path.startsWith('icash_text_messages?')&&method==='PATCH'){
    assert.equal(body.state,'needs_review');assert(path.includes('state=eq.dispatching'));
    await pg.query("update icash_text_messages set state='needs_review' where id=$1 and account_id=$2 and state='dispatching'",[ids.message,ids.account]);return [];
   }
   if(path.startsWith('icash_text_messages?'))return (await pg.query("select body,thread_id,'[]'::jsonb attachments from icash_text_messages where id=$1 and account_id=$2 and state='ready'",[ids.message,ids.account])).rows;
   if(path.startsWith('icash_text_threads?'))return [{recipient:'+12145550101',sender:'+12145550102',sender_pool_assigned:false}];
   if(path.startsWith('icash_text_senders?'))return [{phone:'+12145550102'}];
   if(path.startsWith('icash_voice_configs?'))return [{phone_number_id:'fixture-phone',enabled:true}];
   if(path==='rpc/icash_claim_text'){
    claimCalls++;assert.deepEqual(body,{p_account:ids.account,p_message:ids.message,p_sender:'+12145550102'});
    const result=(await one('select icash_claim_text($1,$2,$3) result',[body.p_account,body.p_message,body.p_sender])).result;
    if(hold==='unknown_final_claim'&&!recovered)throw Error('Fixture lost claim response after commit');
    return result;
   }
   throw Error('Unexpected fixture boundary '+path);
  };
  const {dispatchTextMessage}=await loadService('lib/text-message-service.ts',{
   db,process:{env},instantLeadsEnabled:()=>false,smsWorkEnabled:()=>true,liveWorkReady:()=>true,
   sameBusinessNumber:(a,b)=>a===b,elevenRequest:async()=>{if(hold==='number_verification'&&!recovered)throw Error('Fixture verification unavailable');return {phone_number:'+12145550102'};},
   textPayload:()=>{},SellerInventoryUnavailableError:class extends Error{},TextClaimRefusedError,
   sendContiguityText:async()=>{sends++;if(hold==='unknown_provider')throw Error('Fixture unknown provider response');return {messageId:'fixture-receipt'};},
   saveTextReceipt:async(_db,account,message,provider)=>{
    assert.equal(account,ids.account);assert.equal(message,ids.message);
    await pg.query("update icash_text_messages set state='accepted',provider_id=$1 where id=$2 and state='dispatching'",[provider,message]);return {status:'message_accepted'};
   },
  });
  const {processDealJourneys}=await loadService('lib/deal-journey-service.ts',{});
  const run=()=>processDealJourneys({db,dispatch:dispatchTextMessage,send:()=>assert.fail('No contract'),text:()=>assert.fail('No contract text'),title:()=>assert.fail('No title email')},{VERCEL_ENV:'production',ICASH_LIVE_WORK_READY:'true',DOCUSEAL_MODE:'live'});
  if(hold==='configuration')delete env.CONTIGUITY_API_KEY;
  await pg.exec('update fixture_gates set admit='+(hold!=='final_admission'));
  for(let poll=0;poll<4;poll++){await due();await run();}
  if(hold.startsWith('unknown_')){
   assert.equal(sends,hold==='unknown_provider'?1:0);assert.equal((await state()).state,'needs_review');
   assert.equal((await state()).text_state,hold==='unknown_provider'?'needs_review':'dispatching');
  }else{
   assert.equal(sends,0);assert.equal((await state()).attempts,4);assert.equal((await state()).text_state,'ready');
   assert.equal((await state()).provider_id,null);assert.equal((await state()).state,'ready');
   assert.equal(claimCalls,hold==='final_admission'?4:0);
  }
  recovered=true;env.CONTIGUITY_API_KEY='fixture-only';await pg.exec('update fixture_gates set admit=true');await due();await run();
  assert.equal(sends,hold==='unknown_final_claim'?0:1);
  await due();await run();assert.equal(sends,hold==='unknown_final_claim'?0:1,'No original provider attempt replay');
  if(!hold.startsWith('unknown_'))assert.equal((await state()).state,'sent');
 }
 console.log('PASS actual journey + dispatch services: repeated configuration, number-verification and final-admission deferrals recover; unknown final claims/provider attempts never replay.');
}finally{await pg.close();}
