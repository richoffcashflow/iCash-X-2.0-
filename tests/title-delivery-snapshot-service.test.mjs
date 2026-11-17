import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {closingPayoutNote} from '../lib/closing-setup.ts';
import {titleConfirmationInstructionsFor} from '../lib/title-confirmation-instructions.ts';
import {installTitleDeliveryFixture,deliveryCase,read,migrationPath} from './fixtures/title-delivery-fixture.mjs';
const db=await PGlite.create(),oldEnv={...process.env};let active,change,loaded,sends=0,payload,timeout=false;
const service=await loadService('lib/title-service.ts',{closingPayoutNote,titleConfirmationInstructionsFor,
 db:async(path,method,body)=>{
  if(path==='rpc/icash_title_request_delivery_snapshot'){assert.equal(body.p_account,active.account);assert.equal(body.p_id,active.job.id);loaded=await active.snapshot();return structuredClone(loaded);}
  if(path==='rpc/icash_claim_title_request_snapshot'){assert.deepEqual(body.p_expected,loaded);return active.claim(body.p_expected);}
  if(path===`icash_title_requests?id=eq.${active.job.id}&state=eq.dispatching`&&method==='PATCH')return db.query("update icash_title_requests set state=$2,provider_id=coalesce($3,provider_id),delivered_assignment_ids=coalesce($4,delivered_assignment_ids),delivered_payout=coalesce($5,delivered_payout) where id=$1 and state='dispatching'",[active.job.id,body.state,body.provider_id??null,body.delivered_assignment_ids??null,body.delivered_payout??null]);
  throw Error('Unexpected fixture path');
 },
 completedSigningPdf:async(account,id,audit,source)=>{assert.equal(account,active.account);assert.equal(source.id,id);assert.equal(audit,false);assert.equal(source.providerId,'original-'+id);if(change){const action=change;change=null;await action(active);}return new Uint8Array([1,2,3]).buffer;},
 fetch:async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'title-'+active.job.id);payload=JSON.parse(options.body);sends++;if(timeout)throw Error('Unknown provider outcome');return Response.json({id:'original-email'});}
});
try{
 for(const name of ['RESEND_API_KEY','RESEND_RECEIVING_WEBHOOK_SECRET','ICASH_TITLE_FROM_EMAIL','ICASH_TITLE_REPLY_EMAIL'])process.env[name]='fixture@example.invalid';process.env.ICASH_LIVE_WORK_READY='true';
 await installTitleDeliveryFixture(db);await db.exec('begin;'+read(migrationPath)+'commit;');
 for(const action of [c=>c.replace(),c=>c.setPayout({...c.payout,payeeName:'Updated fixture LLC'})]){active=await deliveryCase(db);change=action;const before=sends;assert.equal((await service.dispatchTitleRequest(active.account,active.job.id)).status,'title_request_held');assert.equal(sends,before);assert.equal(await active.spends(),0);}
 active=await deliveryCase(db);assert.equal((await service.dispatchTitleRequest(active.account,active.job.id)).status,'title_request_sent');assert.equal(sends,1);assert.equal(payload.attachments.length,2);assert(payload.text.includes('Agreement: '+active.assignment));assert(payload.text.includes('legal payee Fixture LLC'));assert.equal((await service.dispatchTitleRequest(active.account,active.job.id)).status,'title_request_held');assert.equal(sends,1);
 const row=(await db.query('select * from icash_title_requests where id=$1',[active.job.id])).rows[0];assert.deepEqual(row.delivered_assignment_ids,[active.assignment]);assert.equal(row.delivered_payout.payeeName,'Fixture LLC');
 active=await deliveryCase(db);timeout=true;assert.equal((await service.dispatchTitleRequest(active.account,active.job.id)).status,'title_delivery_needs_reconciliation');assert.equal(sends,2);assert.equal((await service.dispatchTitleRequest(active.account,active.job.id)).status,'title_request_held');assert.equal(sends,2);assert.equal(await active.spends(),1);
 console.log('PASS actual title service + SQL: replacement/payout during PDF loading admits no send or reservation, current bound bytes send once, unknown outcomes remain original holds.');
}finally{await db.close();for(const name of ['RESEND_API_KEY','RESEND_RECEIVING_WEBHOOK_SECRET','ICASH_TITLE_FROM_EMAIL','ICASH_TITLE_REPLY_EMAIL','ICASH_LIVE_WORK_READY']){if(oldEnv[name]===undefined)delete process.env[name];else process.env[name]=oldEnv[name];}}
