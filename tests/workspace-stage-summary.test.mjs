import assert from 'node:assert/strict';
import {agreementWorkspace} from '../lib/agreement-workspace.ts';
import {dealToolVisibility} from '../lib/property-contract-visibility.ts';

const purchase={id:'purchase',deal_id:'deal',kind:'purchase',state:'awaiting_counterparty',test_mode:false};
assert.equal(agreementWorkspace('draft',[purchase]).title,'Waiting for seller signatures');
assert.equal(agreementWorkspace('draft',[purchase]).signatureId,null);
assert.equal(agreementWorkspace('under_contract',[{...purchase,state:'customer_signature_needed'}]).signatureId,'purchase','stage labels do not hide a required signature');
assert.equal(agreementWorkspace('draft',[{...purchase,state:'completed',test_mode:true}]).purchaseSigned,false);
assert.equal(agreementWorkspace('draft',[{...purchase,state:'completed',test_mode:true}]).title,'Test agreement');
assert.equal(agreementWorkspace('draft',[{...purchase,state:'customer_signature_needed',test_mode:true}]).signatureId,'purchase','test signing is reachable and labelled without advancing a deal');
const signed={...purchase,state:'completed'};
assert.equal(agreementWorkspace('draft',[signed]).purchaseSigned,true,'verified signatures win over a lagging stage label');
const buyer={...purchase,id:'assignment',kind:'assignment'};
assert.equal(agreementWorkspace('under_contract',[signed,buyer]).title,'Waiting for buyer signatures');
assert.equal(agreementWorkspace('under_contract',[signed,{...buyer,state:'customer_signature_needed'}]).signatureId,'assignment');
for(const stage of ['cancellation_pending','canceled','cancelled'])assert.equal(agreementWorkspace(stage,[{...purchase,state:'customer_signature_needed'}]).signatureId,null);
assert.equal(dealToolVisibility({id:'deal',stage:'cancellation_pending'},[signed],'closing').buyers,true,'an urgent closing review remains reachable while the deal is stopped');
console.log('PASS workspace summaries: seller wait, required signatures, test mode, signed purchase, buyer wait and cancellation priority.');
