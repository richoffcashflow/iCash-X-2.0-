import assert from 'node:assert/strict';
import {recoverOrdinaryCheckout} from '../lib/legacy-checkout-recovery.ts';
const owner={guest:'a'.repeat(64),userId:null,mode:'live',email:'fixture@example.invalid'};
const member={id:'member',stripe_session_id:'cs_live_original',state:'pending',legacy_trial_offer:null,stripe_subscription_id:null,paid_through:null};
const session={id:member.stripe_session_id,mode:'subscription',livemode:true,status:'open',subscription:null,payment_intent:null,metadata:{icash_membership:member.id}};
function fixture({rows=[member],initial=session,after={...session,status:'expired'},expireError=false,readError=false,releaseError=false}={}){
 let current=initial;const calls=[];
 const db=async(path,method,body)=>{calls.push({path,method,body});if(path.endsWith('recovery'))return rows;if(releaseError)throw Error('Concurrent billing hold');return null;};
 const stripe={checkout:{sessions:{retrieve:async id=>{calls.push({read:id});if(readError)throw Error('Unavailable');return current;},expire:async id=>{calls.push({expire:id});current=after;if(expireError)throw Error('Concurrent completion');return current;}}}};
 const run=()=>recoverOrdinaryCheckout(db,stripe,owner,async m=>calls.push({reconcile:m.id}));
 return {calls,run};
}
let f=fixture();assert.equal(await f.run(),null);assert.deepEqual(f.calls.map(c=>c.path??Object.keys(c)[0]),['rpc/icash_ordinary_checkout_recovery','read','expire','read','rpc/icash_release_ordinary_checkout']);
assert.deepEqual(f.calls.at(-1).body.p_receipt,{id:session.id,status:'expired',mode:'subscription',livemode:true,subscription:null,payment_intent:null,membership:member.id});
for(const opts of [{initial:{...session,status:'expired'}},{expireError:true}]){f=fixture(opts);await f.run();assert(f.calls.some(c=>c.path?.endsWith('release_ordinary_checkout')));}
for(const opts of [{initial:{...session,status:'complete',subscription:'sub_completed'}},{after:{...session,status:'complete',subscription:'sub_completed'},expireError:true}]){f=fixture(opts);assert.equal(await f.run(),member.id);assert(f.calls.some(c=>c.reconcile===member.id));assert(!f.calls.some(c=>c.path?.endsWith('release_ordinary_checkout')));}
for(const opts of [{rows:[{...member,stripe_session_id:null}]},{rows:[{...member,stripe_subscription_id:'sub_existing'}]},{rows:[{...member,state:'needs_review'}]},{rows:Array(6).fill(member)},{initial:{...session,livemode:false}},{initial:{...session,id:'cs_live_other'}},{initial:{...session,mode:'payment'}},{initial:{...session,metadata:{icash_membership:'other'}}},{initial:{...session,metadata:{...session.metadata,icash_legacy_trial:'trial'}}},{after:{...session,status:'open'},expireError:true},{initial:{...session,status:'expired',subscription:'sub_held'}},{initial:{...session,status:'expired',payment_intent:'pi_held'}},{readError:true}]){
 f=fixture(opts);await assert.rejects(f.run());assert(!f.calls.some(c=>c.path?.endsWith('release_ordinary_checkout')));assert(!f.calls.some(c=>c.reconcile));
}
f=fixture({releaseError:true});await assert.rejects(f.run());
f=fixture({rows:[]});assert.equal(await f.run(),null);assert.equal(f.calls.length,1,'No owned row means no provider contact');
console.log('PASS checkout recovery: exact canonical expiry, same-session race recovery, complete-session reuse, unknown/held bindings stop, bounded selection, no real provider calls.');
