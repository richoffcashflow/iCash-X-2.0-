// Read-only inspection. Run only in an existing trusted server runtime with its
// existing environment injected. Never exports keys, configuration bodies or contacts.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {costCategories} from '../lib/cost-guard.ts';

export async function voicePreflight({env=process.env,fetcher=fetch,accountId,now=Date.now()}={}) {
 const result={readOnly:true,callsPlaced:0,configurationVerified:false,blockers:[],accounts:[],notVerified:['tool_definitions_and_disclosures','inbound_forwarding_and_failure_behavior','provider_plan_prices','authorized_end_to_end_call']};
 const add=(code)=>result.blockers.push(code);
 if(accountId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)){add('invalid_account_id');return result;}
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY){add('database_environment_missing');return result;}
 let origin;try{origin=new URL(env.SUPABASE_URL);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error();}catch{add('database_origin_invalid');return result;}
 const get=async(url,headers)=>{const response=await fetcher(url,{method:'GET',headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('read_failed');return response.json();};
 const db=(path)=>get(`${origin.origin}/rest/v1/${path}`,{apikey:env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${env.SUPABASE_SECRET_KEY}`});
 const provider=(path)=>get(`https://api.elevenlabs.io/v1/convai/${path}`,{'xi-api-key':env.ELEVENLABS_API_KEY});
 if(!env.ELEVENLABS_API_KEY)add('voice_provider_environment_missing');
 if(!/^\+[1-9]\d{7,14}$/.test(env.CONTIGUITY_FROM??''))add('business_number_missing');
 let configs,rates,practice;
 try{
  // Never silently pass a truncated account inventory. Operators can scope an account.
  configs=await db(`icash_voice_configs?select=*&order=account_id&limit=1001${accountId?`&account_id=eq.${accountId}`:''}`);
  rates=await db('icash_operation_rates?select=id,operation,enabled,verified_at,expires_at,voice_max_duration_seconds,costs_micros,evidence_ref&operation=in.(seller_call,buyer_call,incoming_call)&limit=1001');
  practice=await db('icash_voice_test_config?select=agent_id');
  if(!Array.isArray(configs)||!Array.isArray(rates)||!Array.isArray(practice))throw Error();
 }catch{add('database_read_failed');return result;}
 if(configs.length>1000||rates.length>1000){add('inventory_limit_requires_scoped_review');return result;}
 if(!configs.length)add('production_voice_configuration_missing');
 const validRate=(id,operation,duration)=>rates.some(r=>r.id===id&&r.operation===operation&&r.enabled===true&&Date.parse(r.verified_at)<=now&&Date.parse(r.expires_at)>now&&r.voice_max_duration_seconds>=duration&&typeof r.evidence_ref==='string'&&r.evidence_ref.length>10&&costCategories.every(k=>Number.isSafeInteger(r.costs_micros?.[k])&&r.costs_micros[k]>=0));
 for(const c of configs){
  const check={accountId:c.account_id,checks:{enabled:c.enabled===true,reviewCurrent:Date.parse(c.reviewed_until)>now,durationBounded:Number.isInteger(c.max_duration_seconds)&&c.max_duration_seconds>=60&&c.max_duration_seconds<=900,productionAgent:!practice.some(p=>p.agent_id===c.agent_id),sellerRate:validRate(c.seller_rate_id,'seller_call',c.max_duration_seconds),buyerRate:validRate(c.buyer_rate_id,'buyer_call',c.max_duration_seconds),providerRead:false,callerIdMatches:false,agentHashMatches:false,providerDurationBounded:false,requiredToolsPresent:false}};
  if(env.ELEVENLABS_API_KEY){
   try{
    const [phone,agent]=await Promise.all([provider(`phone-numbers/${encodeURIComponent(c.phone_number_id)}`),provider(`agents/${encodeURIComponent(c.agent_id)}`)]);
    const config=agent.conversation_config;const cap=config?.conversation?.max_duration_seconds;
    check.checks.providerRead=true;
    check.checks.callerIdMatches=/^\+[1-9]\d{7,14}$/.test(env.CONTIGUITY_FROM??'')&&phone.phone_number===env.CONTIGUITY_FROM&&phone.provider==='twilio';
    check.checks.agentHashMatches=!!config&&createHash('sha256').update(JSON.stringify(config)).digest('hex')===c.agent_config_hash;
    check.checks.providerDurationBounded=Number.isInteger(cap)&&cap>=60&&cap<=c.max_duration_seconds;
    check.checks.requiredToolsPresent=Array.isArray(c.required_tool_ids)&&new Set(c.required_tool_ids).size>=2&&c.required_tool_ids.every(id=>config?.agent?.prompt?.tool_ids?.includes(id));
   }catch{/* Do not print provider errors, payloads or identifiers. */}
  }
  result.accounts.push(check);
 }
 if(result.accounts.some(a=>Object.values(a.checks).some(v=>v!==true)))add('account_voice_checks_failed');
 result.configurationVerified=result.blockers.length===0;
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const report=await voicePreflight({accountId:process.argv[2]});console.log(JSON.stringify(report,null,2));if(!report.configurationVerified)process.exitCode=1;}
 catch{console.error('VOICE_PREFLIGHT_FAILED');process.exitCode=1;}
}
