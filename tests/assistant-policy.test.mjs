import assert from 'node:assert/strict';
import {assistantIntroduction,verifiedDealMemory,assistantActionDecision as decide} from '../lib/assistant-policy.ts';
const identity={tenantId:'a',name:'Alex',principal:'Sample Property Group',verified:true};
assert.match(assistantIntroduction(identity,'a'),/AI assistant.*Sample Property Group/);
assert.equal(assistantIntroduction(identity,'b'),null);
assert.match(assistantIntroduction({...identity,tenantId:'b',name:'Jordan'},'b'),/I'm Jordan/);
assert.equal(assistantIntroduction({...identity,name:''},'a'),null);
const scope={tenantId:'a',dealId:'1'};
const fact={...scope,id:'f',value:'Seller requested callback',sourceId:'call1',verified:true,expiresAt:200};
assert.deepEqual(verifiedDealMemory(scope,[fact,{...fact,tenantId:'b'},{...fact,dealId:'2'},{...fact,verified:false},{...fact,expiresAt:100}],100),[fact]);
const base={scope,recordScope:scope,identity,paused:false,humanOwnsConversation:false,memoryVersion:2,acknowledgedMemoryVersion:2,permissionConfirmed:true,contactWindowOpen:true,suppressed:false,exclusiveContactLease:true,operationAlreadyCompleted:false,creditsReserved:true,authorityExpiresAt:200,now:100,maxOfferCents:12000000,offerCents:11500000,ownershipVerified:true,owners:[{id:'owner1',approved:true},{id:'owner2',approved:true}],signingAuthorized:false};
assert.equal(decide('send_contract',base),'ready');
for (const [patch,reason] of [
 [{recordScope:{...scope,dealId:'2'}},'scope_mismatch'],
 [{humanOwnsConversation:true},'paused'],
 [{acknowledgedMemoryVersion:1},'refresh_conversation'],
 [{exclusiveContactLease:false},'contact_in_use'],
 [{suppressed:true},'contact_blocked'],
 [{creditsReserved:false},'needs_credits'],
 [{operationAlreadyCompleted:true},'already_completed'],
 [{authorityExpiresAt:100},'needs_authorization'],
 [{offerCents:12000001},'offer_needs_review'],
 [{offerCents:NaN},'offer_needs_review'],
 [{owners:[{id:'owner1',approved:true},{id:'owner2',approved:false}]},'owners_need_review'],
 [{owners:[]},'owners_need_review'],
 [{ownershipVerified:false},'owners_need_review']
]) assert.equal(decide('send_contract',{...base,...patch}),reason);
assert.equal(decide('sign_contract',base),'signature_needs_authorization');
assert.equal(decide('sign_contract',{...base,signingAuthorized:true}),'ready');
console.log('Assistant policy: identity, isolation, handoff, permission, owners and authority passed');
