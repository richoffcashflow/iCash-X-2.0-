import assert from 'node:assert/strict';
import {analyzeText,validateTextAnalysis,textConversationInstructions,textActions} from '../lib/text-ai-policy.ts';
const raw={action:'review',reply:'Untrusted draft, never sent',summary:'Untrusted summary',facts:[]};
const enabled=(body,value=raw)=>validateTextAnalysis(value,[body],'seller',true);
assert.equal(enabled('Can you call me?').action,'ask_callback_details');
assert.equal(enabled('Call me tomorrow',{...raw,action:'handoff'}).humanRequested,false);
assert.equal(enabled('Call me tomorrow').callRequested,true);
assert.equal(enabled('Call me tomorrow').callbackRequested,false);
assert.equal(enabled('Are you a real person?',{...raw,action:'handoff'}).action,'reply_identity');
assert.equal(enabled('Who is this?',{...raw,action:'ask_price'}).action,'reply_identity');
assert.equal(enabled('Are you a human?',{...raw,action:'reply_identity'}).humanRequested,false);
assert.equal(enabled('I want a real person to call me').humanRequested,true);
assert.equal(enabled('Please stop texting me, call me tomorrow').optedOut,true);
assert.equal(enabled('Not interested, call me tomorrow').action,'review');
assert.equal(validateTextAnalysis(raw,['Call me tomorrow'],'seller').humanRequested,true);
assert.equal(validateTextAnalysis(raw,['Call me tomorrow'],'buyer',true).humanRequested,true);
assert.equal(enabled('Thursday at 3 PM',{...raw,facts:[{kind:'callback',quote:'Thursday at 3 PM'}]}).action,'ask_callback_details');
assert.equal(enabled('My kitchen needs repairs',{...raw,facts:[{kind:'callback',quote:'tomorrow'}]}).callRequested,false);
assert.equal(enabled('No roof photos yet',{...raw,facts:[{kind:'photos',quote:'roof photos'}]}).facts[0].quote,'No roof photos yet');
for(const action of ['reply_identity','ask_photos','ask_callback_details','acknowledge_callback','photo_received','explain_process','explain_price'])assert(textActions.includes(action));
assert.match(textConversationInstructions('seller',true),/No offer or negotiation is authorized/);
assert.match(textConversationInstructions('seller',true),/exact date, time and time zone/);
assert.match(textConversationInstructions('seller',true),/have not inspected images/);
assert.match(textConversationInstructions('seller',false),/call requests go to the existing handoff/);
let payload;
const response=await analyzeText({model:'fixture',context:{},party:'seller',conversationEnabled:true,messages:[{direction:'incoming',body:'Here are pictures',attachments:[{url:'https://example.invalid/private.jpg'}]}]},'fixture',async(_,options)=>{
 payload=JSON.parse(options.body);
 return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...raw,action:'photo_received'})}}]});
});
assert.equal(response.analysis.action,'photo_received');
assert.equal(JSON.parse(payload.messages[1].content).messages[0].hasAttachments,true);
assert(!payload.messages[1].content.includes('private.jpg'));
assert(payload.response_format.json_schema.schema.properties.facts.items.properties.kind.enum.includes('photos'));
console.log('Seller conversation policy: scoped callback/human distinction, STOP, legacy behavior, quoted photo facts, bounded attachment presence and no provider calls passed.');

for(const question of ['Are you the owner of 123 Main Street?', 'Do you own 123 Main Street?', 'Is 123 Main Street your property?']){
 const result=await analyzeText({model:'fixture',context:{},messages:[{direction:'outgoing',body:'Hi Jordan, AI for Bright Homes here. '+question},{direction:'incoming',body:'Yes'}]},'fixture',async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...raw,action:'ask_price'})}}]}));
 assert.equal(result.analysis.action,'review','An ownership-only answer never unlocks legacy qualification from a new opener variant');
}
for(const [attachmentCount,expected] of [[2,true],[0,false],[-1,false],[Infinity,false]]){
 await analyzeText({model:'fixture',context:{},party:'seller',conversationEnabled:true,messages:[{direction:'incoming',body:'Pictures',attachmentCount}]},'fixture',async(_,options)=>{
  const data=JSON.parse(JSON.parse(options.body).messages[1].content);
  assert.equal(data.messages[0].hasAttachments,expected);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]});
 });
}

for(const question of ['Are you a real person or AI?','Are you human? Who is this?','Are you a human being?','Is this automated?']){
 assert.equal(enabled(question,{...raw,action:'handoff'}).action,'reply_identity',question);
}
for(const request of ['Are you human? I want a real person.','Who is this? Can I speak to your manager?']){
 assert.equal(enabled(request,{...raw,action:'reply_identity'}).humanRequested,true,request);
}
