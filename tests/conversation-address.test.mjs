import assert from 'node:assert/strict';
import {conversationStreet,spokenStreet,conversationAddressFields,conversationAddressInstructions} from '../lib/conversation-address.ts';
import {sellerFirstMessage,ownershipAlreadyConfirmed} from '../lib/seller-call-context.ts';
import {buyerFirstMessage} from '../lib/buyer-call-policy.ts';
import {receptionContextVariables} from '../lib/reception-property-context.ts';
import {automaticOfferReceptionPolicy,automaticOfferReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {inboundInitiation} from '../lib/inbound-voice.ts';
import {propertyReceptionVariables} from '../lib/reception-property-context.ts';
import {buyerReceptionVariables} from '../lib/buyer-reception-context.ts';
import {signatureRequestMessage} from '../lib/signing-invitation.ts';
const address='650 GLADIOLA LOOP, KYLE, TX 78640';
assert.deepEqual(conversationAddressFields(address),{address:'650 GLADIOLA LOOP',city:'KYLE',state:'Texas'});
assert.deepEqual(conversationAddressFields('123 Main St, Apt 4B, Albany, NY 12207, USA'),{address:'123 Main Street Apartment 4B',city:'Albany',state:'New York'});
assert.equal(conversationStreet('123 Main St Unit 4B, Albany, NY 12207'),'123 Main St Unit 4B');
assert.equal(conversationStreet('45 Oak Road'),'45 Oak Road');
const history={threadId:'bound',messages:[{id:'q',direction:'outgoing',body:'Hi Josh, are you the owner of 650 GLADIOLA LOOP?',at:'2026-10-09T03:25:00Z'},{id:'a',direction:'incoming',body:'Yes',at:'2026-10-09T03:26:00Z'}]};
assert(ownershipAlreadyConfirmed(history,address));
assert(!ownershipAlreadyConfirmed(history,'651 GLADIOLA LOOP, KYLE, TX 78640'));
assert(!ownershipAlreadyConfirmed(history,'650 GLADIOLA LOOP Unit 2, KYLE, TX 78640'));
const c={address,principal:'Fixture buyer',assistantName:'Jamie',history,callbackRequestedNow:true};
assert.equal(sellerFirstMessage(c),"Let's go over the cash offer for 650 GLADIOLA LOOP.");
assert.equal(sellerFirstMessage({...c,history:null}),'Is this the owner of 650 GLADIOLA LOOP?');
assert(!buyerFirstMessage({address,firstName:'Jane'}).includes('TX'));
const config={context_policy:automaticOfferReceptionPolicy,context_policy_hash:automaticOfferReceptionPolicyHash,context_approval_reference:'Owner requested street-only speech',agreement_tool_id:'tool_fixture'};
const vars=receptionContextVariables(config,{status:'matched',address,returningName:'Josh',smsContext:history});
assert.equal(vars.icash_property_greeting,"Hi Josh. Let's continue with the cash offer for 650 GLADIOLA LOOP.");
const safe=JSON.parse(vars.icash_property_context);assert.equal(safe.address,'650 GLADIOLA LOOP');assert.equal(safe.state,'Texas');assert.equal(safe.ownershipAlreadyConfirmed,true);
assert.equal(c.address,address,'Canonical record stays complete');
console.log('PASS street-only seller, buyer and return-call greetings; full state names; units and ownership continuity.');

// The actual speech inputs expand abbreviations without rewriting stored or written addresses.
for(const [input,spoken] of [
 ['3614 Frank St, Dallas, TX 75210','3614 Frank Street'],
 ['3614 FRANK ST., DALLAS, TX 75210','3614 FRANK Street'],
 ['42 Oak Ln','42 Oak Lane'],['42 Oak ln.','42 Oak Lane'],
 ['42 N Oak Rd','42 North Oak Road'],['42 Oak Dr NW','42 Oak Drive Northwest'],
 ['42 W Oak Ave Apt 4B','42 West Oak Avenue Apartment 4B'],
 ['42 Oak Blvd, Ste 2-N, Dallas, TX 75210','42 Oak Boulevard Suite 2-N'],
 ['42 Oak Ct #7','42 Oak Court Unit 7'],['42 Oak Cir Unit N','42 Oak Circle Unit N'],
 ['42 Oak Pl','42 Oak Place'],['42 Oak Pkwy','42 Oak Parkway'],
 ['42 Oak Ter','42 Oak Terrace'],['42 Oak Trl','42 Oak Trail'],
 ['42 Hwy 75','42 Highway 75'],['42 Oak Rd Bldg 2 Apt 4B','42 Oak Road Building 2 Apartment 4B'],
 ['42 St. Charles St','42 St. Charles Street'],
 ['42 Dr. Martin Luther King Jr Blvd','42 Dr. Martin Luther King Jr Boulevard'],
 ['42 N St','42 N Street'],['42 Constructor','42 Constructor'],
]){assert.equal(spokenStreet(input),spoken,input);assert.equal(spokenStreet(spoken),spoken,'Repeated speech formatting is stable');}
const abbreviated='3614 Frank St, Dallas, TX 75210';
assert.equal(sellerFirstMessage({...c,address:abbreviated,history:null}),'Is this the owner of 3614 Frank Street?');
assert(buyerFirstMessage({address:abbreviated,firstName:'Jane'}).includes('3614 Frank Street'));
assert(propertyReceptionVariables({status:'matched',address:abbreviated}).icash_property_greeting.includes('3614 Frank Street'));
assert(buyerReceptionVariables({status:'buyer',address:abbreviated,askingPriceCents:12500000}).icash_property_greeting.includes('3614 Frank Street'));
assert(inboundInitiation(600,'fixture-token',{status:'matched',address:abbreviated}).conversation_config_override.agent.first_message.includes('3614 Frank Street'));
const confirmedStreet={threadId:'bound',messages:[{id:'q',direction:'outgoing',body:'Is this the owner of 3614 Frank Street?',at:'2026-10-09T03:25:00Z'},{id:'a',direction:'incoming',body:'Yes',at:'2026-10-09T03:26:00Z'}]};
const resumed=receptionContextVariables(config,{status:'matched',address:abbreviated,smsContext:confirmedStreet});
assert.equal(resumed.icash_property_greeting,"Let's continue with the cash offer for 3614 Frank Street.");
assert.equal(JSON.parse(resumed.icash_property_context).address,'3614 Frank Street');
assert(ownershipAlreadyConfirmed(confirmedStreet,abbreviated));
assert(!ownershipAlreadyConfirmed(confirmedStreet,'3615 Frank St, Dallas, TX 75210'));
assert(!ownershipAlreadyConfirmed(confirmedStreet,'3614 Frank St Unit 2, Dallas, TX 75210'));
assert(ownershipAlreadyConfirmed({...confirmedStreet,messages:[{...confirmedStreet.messages[0],body:'Is this the owner of 3614 Frank St?'},confirmedStreet.messages[1]]},abbreviated),'Old abbreviated history remains valid');
assert.equal(conversationStreet(abbreviated),'3614 Frank St');
assert(signatureRequestMessage('Fixture Homes',abbreviated,false).body.includes('3614 Frank St.'));
assert(!signatureRequestMessage('Fixture Homes',abbreviated,false).body.includes('Frank Street'));
assert(conversationAddressInstructions.includes('Frank St is Frank Street'));
assert(conversationAddressInstructions.includes('Oak Ln is Oak Lane'));
console.log('PASS spoken abbreviations across seller/buyer/incoming/return-call paths, ownership continuity, and unchanged written addresses.');
