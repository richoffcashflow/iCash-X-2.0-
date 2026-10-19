// Offline source-word fixtures. No provider calls or live records.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {sellerResponseDisposition,sellerCallDisposition,sellerResponsePatterns} from '../lib/seller-response-policy.ts';
import {isContactOptOut} from '../lib/contact-intent.ts';
import {validateTextAnalysis} from '../lib/text-ai-policy.ts';
import {liveConversationResult} from '../lib/deal-conversation.ts';
import {replyToInstantLeadText} from '../lib/meta-instant-text.ts';
const fixtures=[
 ['Stop text me','opt_out'],['Stop contact me','opt_out'],['Stop call me','opt_out'],['Stop message me','opt_out'],['Stop email me','opt_out'],['Please stop text','opt_out'],
 ['Stop calling me','opt_out'],['Stop texting me','opt_out'],['Stop contacting me','opt_out'],['Stop messaging me','opt_out'],['Stop emailing me','opt_out'],
 ["Please don't stop calling",null],["Please don't stop calling me",null],["Don't stop text me",null],['I did not say stop contact me',null],['You wrote "stop text me" in your message',null],['Stop call it vacant',null],
 ['Not interested.','declined'],['I’m not super interested','declined'],['not very interested','declined'],['not really interested','declined'],['I am not interested in selling','declined'],['No thanks','declined'],['Wrong number','declined'],['I do not want to sell my house','declined'],['No quiero vender.','declined'],
 ['This is a scam','review'],['SCAM!','review'],['Are you a scammer?','review'],['not a scam?','review'],['How do I know this is not a scam?','review'],['I don’t trust you','review'],['This is suspicious','review'],['I am not comfortable','review'],['Not now','review'],['I need to think','review'],['I am not ready','review'],['Hold off','review'],['I am not interested at that price','review'],
 ['I am not interested in selling unless you can leave your number.','review'],['I am not interested. Stop leaving me voicemail.','declined'],['Do not call me or leave voicemail.','opt_out'],['Stop calling me. You keep leaving messages in my mailbox.','opt_out'],['Please do not email me again.','opt_out'],['You said you would stop calling me, stop calling me now.','opt_out'],['I am not interested in texting, call my lawyer. I am not interested in selling.','declined'],['The tenant said \"not interested\", but I want to sell.',null],['Hi,\n\nPlease unsubscribe.','opt_out'],['Hi,\n\nUnsubscribe.','opt_out'],['I did not say please unsubscribe.',null],["I didn't say, don't call me",null],["I didn't say stop calling before, stop calling me now",'opt_out'],['STOP','opt_out'],['dnc','opt_out'],['Please put me on your DNC list','opt_out'],['Do not call','opt_out'],['Don’t call me','opt_out'],['Never call me','opt_out'],['stop texting me','opt_out'],['Remove my number','opt_out'],['Leave me alone','opt_out'],['I do not want you to call','opt_out'],['STOP. Call me tomorrow','opt_out'],['I did not say stop texting, but stop calling me','opt_out'],
 ['The house is in bad condition',null],['The house is not ready for inspection',null],['The house is not comfortable in winter',null],['It needs a roof and has serious water damage',null],['I am not happy with the condition of the house',null],['I am interested in selling',null],['This is not a scam, happy to proceed',null],["This isn't a scam",null],['I never said "not interested". I want to sell.',null],['I did not say "stop calling"',null],["Don't stop calling me",null],['You said “not interested” but I am interested',null],["Don't call it vacant, it has tenants",null],['Can you stop by tomorrow?',null],['I am not interested in texting, can we talk?',null],['No',null],['',null],['...',null],
];
const pg=await PGlite.create();
try{
 await pg.exec('create role anon; create role authenticated; create role service_role;');
 const sql=readFileSync(new URL('../config/seller-response-policy.sql',import.meta.url),'utf8');
 assert.equal(sql,readFileSync(new URL('../supabase/migrations/20261019183400_seller_response_policy.sql',import.meta.url),'utf8'));
 await pg.exec(sql);
 assert.equal((await pg.query("select icash_seller_response_disposition('Stop text me') d")).rows[0].d,null,'reproduce installed base-verb regression before forward patch');
 const forward=readFileSync(new URL('../config/seller-optout-base-verbs.sql',import.meta.url),'utf8');
 assert.equal(forward,readFileSync(new URL('../supabase/migrations/20261019190820_seller_optout_base_verbs.sql',import.meta.url),'utf8'));
 const originalDefinition=(await pg.query("select pg_get_functiondef('icash_seller_response_disposition(text)'::regprocedure) d")).rows[0].d;
 await pg.exec(forward);
 const currentDefinition=(await pg.query("select pg_get_functiondef('icash_seller_response_disposition(text)'::regprocedure) d")).rows[0].d;
 assert.equal(currentDefinition.replace(forward.split('$new$')[1],forward.split('$old$')[1]),originalDefinition,'only the direct stop/quit verb fragment changes');
 const runtimeSql=(await pg.query("select string_agg(pg_get_functiondef(p.oid),E'\\n') definitions from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('icash_seller_direct_response_match','icash_seller_response_disposition','icash_seller_call_disposition')")).rows[0].definitions;
 for(const pattern of Object.values(sellerResponsePatterns))assert(runtimeSql.includes(pattern.replaceAll('\\b','\\y')),'installed SQL contains the exact mirrored regex');
 for(const [body,expected] of fixtures){
  assert.equal(sellerResponseDisposition(body),expected,'TS: '+body);
  const {rows:[row]}=await pg.query('select public.icash_seller_response_disposition($1) d,public.icash_seller_contact_stop($1) stop',[body]);
  assert.equal(row.d,expected,'SQL: '+body);assert.equal(row.stop,expected==='opt_out',body);
  assert.equal(isContactOptOut(body),expected==='opt_out','ingestion: '+body);
  const analysis=validateTextAnalysis({action:'ask_price',reply:'price?',summary:'ignored',facts:[]},[body],'seller');
  assert.equal(analysis.responseDisposition,expected,'text: '+body);
  if(expected){assert.equal(analysis.action,'review');assert.equal(analysis.callRequested,false);assert.equal(analysis.optedOut,expected==='opt_out');}
 }
 const callCases=[
  ...fixtures.map(([body,result])=>[[{role:'user',message:body}],result]),
  [[{role:'agent',message:'Do you have a unit number?'},{role:'user',message:'No.'}],null],
  [[{role:'agent',message:'Would you consider selling?'},{role:'user',message:'No.'}],'declined'],
  [[{role:'agent',message:'STOP, not interested, scam'},{role:'user',message:'Hello'}],null],
  [[],null],
  [[{role:'user',message:'Please leave your message after the tone.'}],null],
  [[{role:'user',message:'You have reached the scam prevention mailbox. Leave a message.'}],null],
  [[{role:'user',message:'No one is available. Leave a message after the beep.'}],null],
  [[{role:'user',message:'Comunicarte no está disponible. Graba tu mensaje después del tono.'}],null],
  [[{role:'user',message:'I am not interested'},{role:'user',message:'Do not call'}],'opt_out'],
 ];
 for(const [transcript,expected] of callCases){
  assert.equal(sellerCallDisposition(transcript),expected,'TS call: '+JSON.stringify(transcript));
  const {rows:[row]}=await pg.query('select public.icash_seller_call_disposition($1) d',[{transcript,optedOut:false}]);
  assert.equal(row.d,expected,'SQL call: '+JSON.stringify(transcript));
  const c={conversation_id:'fixture',agent_id:'fixture',status:'done',transcript,analysis:{data_collection_results:{interested:{value:true},interest_quote:{value:'I am interested'}}}};
  const result=liveConversationResult(c,{conversationId:'fixture',agentId:'fixture',party:'seller'});
  assert.equal(result.optedOut,expected==='opt_out');
  if(expected){assert.equal(result.interested,false);assert.equal(result.callbackDueAt,null);assert.equal(result.callbackTimezone,null);}
 }
 const hallucinated=liveConversationResult({conversation_id:'fixture',agent_id:'fixture',status:'done',transcript:[],analysis:{data_collection_results:{opted_out:{value:true}}}},{conversationId:'fixture',agentId:'fixture',party:'seller'});
 assert.equal(hallucinated.optedOut,false,'silence and a model flag alone cannot fabricate seller suppression');
 assert.notEqual(hallucinated.callbackStatus,'blocked_opt_out');
 const callback={conversation_id:'fixture',agent_id:'fixture',status:'done',transcript:[{role:'user',message:'Call me tomorrow. Actually, I am not super interested.'}],analysis:{data_collection_results:{callback_requested:{value:true},callback_confirmed:{value:true},callback_at:{value:'2026-10-20T14:00:00+00:00'},callback_timezone:{value:'UTC'},callback_quote:{value:'Call me tomorrow.'}}}};
 const stoppedCallback=liveConversationResult(callback,{conversationId:'fixture',agentId:'fixture',party:'seller'},Date.parse('2026-10-19T18:00:00Z'));
 assert.equal(stoppedCallback.callbackStatus,'held_for_seller_response');assert.equal(stoppedCallback.callbackDueAt,null);assert.equal(stoppedCallback.optedOut,false);
 for(const body of ['not super interested','this is a scam','DNC','not a scam?']){
  let reads=0;
  const d={env:{META_INSTANT_LEADS_ENABLED:'true'},db:async(path)=>{reads++;assert.equal(path,'rpc/icash_meta_text_context');return {body,complete:false,paused:false,declined:false};},sms:async()=>assert.fail('no SMS'),voice:async()=>assert.fail('no call')};
  assert.equal(await replyToInstantLeadText(d,'fixture'),true);assert.equal(reads,1,'negative contact-only reply cannot request another address prompt');
 }
 for(const role of ['anon','authenticated'])assert.equal((await pg.query("select has_function_privilege($1,'icash_seller_response_disposition(text)','execute') allowed",[role])).rows[0].allowed,false);
 assert.equal((await pg.query("select has_function_privilege('service_role','icash_seller_response_disposition(text)','execute') allowed")).rows[0].allowed,true);
 await assert.rejects(pg.exec(forward),/Seller opt-out base-verb prerequisite changed/);await pg.exec('rollback');
 console.log(`Seller response policy: ${fixtures.length} text cases, ${callCases.length} call cases, SQL/TS parity, guarded forward migration, ingestion, analysis, live-result and Meta no-send guards passed offline.`);
}finally{await pg.close();}
