import {ownerInboundTarget} from './owner-inbound-acceptance.ts';
import {readRecordedOutboundReadiness} from './recorded-outbound-readiness.ts';
import {readRecordingReview,object} from './required-call-recording.ts';
import {boundedBytes} from './required-call-recording-provider.ts';
import {secondaryCallingReady} from './business-voice-numbers.ts';
import {primaryBusinessPhone,isAdditionalBusinessPhone} from './business-phone-policy.ts';

type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Env=Record<string,string|undefined>;
export type DemoReadinessCheck={id:string;label:string;status:'passed'|'blocked'|'unavailable';detail:string;elapsedMs:number};
export type DemoReadiness={checkedAt:string;elapsedMs:number;setupChecksPass:boolean;mode:'read_only';callsPlaced:0;messagesSent:0;liveCallVerified:false;checks:DemoReadinessCheck[]};
type Voice={enabled:boolean;agent_id:string;agent_config_hash:string;phone_number_id:string;max_duration_seconds:number;required_tool_ids:string[];reviewed_until:string};
type Rate={enabled:boolean;operation:string;expires_at:string};
/** Owner-bound setup inspection only. No lead, permission, claim, reservation,
 * provider write, generated speech, text, or envelope. Never used as admission. */
export async function readDemoReadiness(env:Env,deps:{db:Database;fetcher?:typeof fetch;signal?:AbortSignal;now?:()=>number}):Promise<DemoReadiness>{
 const now=deps.now??Date.now,start=now(),account=ownerInboundTarget.accountId,db=deps.db,review=readRecordingReview(env.RECORDED_OUTBOUND_REVIEW_JSON,start);
 const signal=deps.signal?AbortSignal.any([deps.signal,AbortSignal.timeout(14000)]):AbortSignal.timeout(14000);
 // Deduplicate identical metadata GETs within this inspection only. Every new
 // inspection and the real dispatcher still performs fresh provider checks.
 const reads=new Map<string,Promise<string>>(),fetcher=deps.fetcher??fetch;
 const readOnlyFetch:typeof fetch=async(input,options={})=>{
  if(typeof input!=='string'||(options.method??'GET')!=='GET'||options.body)throw Error('READ_ONLY_REQUIRED');
  let pending=reads.get(input);
  if(!pending){pending=(async()=>{
   signal.throwIfAborted();const r=await fetcher(input,{...options,method:'GET',cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
   if(!r.ok||r.redirected||r.url&&r.url!==input||!/^application\/json(?:;|$)/i.test(r.headers.get('content-type')??'')){await r.body?.cancel().catch(()=>undefined);throw Error('PROVIDER_READ_UNAVAILABLE');}
   return (await boundedBytes(r,262144)).toString('utf8');
  })();reads.set(input,pending);}
  return new Response(await pending,{headers:{'Content-Type':'application/json'}});
 };
 const json=async(url:string,headers:Record<string,string>)=>object(await (await readOnlyFetch(url,{headers})).json());
 const voice=db<Voice[]>(`icash_voice_configs?account_id=eq.${account}&select=enabled,agent_id,agent_config_hash,phone_number_id,max_duration_seconds,required_tool_ids,reviewed_until&limit=2`);
 const lines=Promise.all([
  db<{phone:string}[]>('icash_text_senders?enabled=eq.true&select=phone&limit=17'),
  db<{phone:string}[]>('icash_business_voice_numbers?outbound_enabled=eq.true&forwarding_ready=eq.true&caller_id_sid=not.is.null&select=phone&limit=17'),
 ]).then(([senders,callers])=>{
  if(senders.length>16||callers.length>16)throw Error('LINE_REVIEW_REQUIRED');
  return senders.filter(s=>s.phone===primaryBusinessPhone||isAdditionalBusinessPhone(s.phone)&&callers.some(c=>c.phone===s.phone)).map(s=>s.phone);
 });
 // Attach rejection handlers immediately; a missing release must not leave
 // shared database reads as unhandled rejections.
 void voice.catch(()=>undefined);void lines.catch(()=>undefined);
 const current=(r:Rate|undefined,operation:string)=>!!r&&r.enabled===true&&r.operation===operation&&Date.parse(r.expires_at)>now();
 const run=async(id:string,label:string,good:string,bad:string,inspect:()=>Promise<boolean>):Promise<DemoReadinessCheck>=>{
  const began=now();try{const passed=await inspect();signal.throwIfAborted();return {id,label,status:passed?'passed':'blocked',detail:passed?good:bad,elapsedMs:Math.max(0,now()-began)};}
  catch{return {id,label,status:'unavailable',detail:'Could not finish this check. Check again before calling.',elapsedMs:Math.max(0,now()-began)};}
 };
 const checks=await Promise.all([
  run('account','Owner account','Account is running with available credits.','Account access, Run, credits, or contact settings need attention.',async()=>{
   const [accounts,wallets,member,channel,stops]=await Promise.all([
    db<{owner_user_id:string;bot_paused:boolean}[]>(`icash_accounts?id=eq.${account}&select=owner_user_id,bot_paused&limit=2`),
    db<{balance_cents:number;reserved_cents:number}[]>(`icash_wallets?account_id=eq.${account}&select=balance_cents,reserved_cents&limit=2`),
    db<boolean>('rpc/icash_membership_work_allowed','POST',{p_account:account}),
    db<boolean>('rpc/icash_outreach_voice_current','POST',{p_account:account}),
    db<unknown[]>(`icash_text_suppressions?phone=eq.${encodeURIComponent(ownerInboundTarget.ownerPhone)}&select=phone&limit=1`),
   ]);
   return accounts.length===1&&accounts[0].owner_user_id===ownerInboundTarget.ownerUserId&&accounts[0].bot_paused===false&&wallets.length===1&&Number.isSafeInteger(wallets[0].balance_cents)&&wallets[0].balance_cents>0&&member===true&&channel===true&&stops.length===0;
  }),
  run('agent','AI and cash-offer tools','Current AI configuration and offer/contract tools match the approved setup.','AI, recording, or cash-offer tool setup needs attention.',async()=>{
   if(!review?.offerPolicy||review.fromPhone!==env.CONTIGUITY_FROM||!env.ELEVENLABS_API_KEY||!env.TWILIO_AUTH_TOKEN||review.providerAccountSid!==env.TWILIO_ACCOUNT_SID||['ICASH_LIVE_WORK_READY','ICASH_RECORDED_OUTBOUND_READY','ICASH_RECORDING_RECEIPTS_READY'].some(k=>env[k]!=='true'))return false;
   const [configs,inspection]=await Promise.all([voice,readRecordedOutboundReadiness(env,{fetcher:readOnlyFetch,signal,now})]);
   const c=configs[0];return configs.length===1&&!!c&&c.enabled&&Date.parse(c.reviewed_until)>now()&&c.agent_id===review.agentId&&c.agent_config_hash===review.configHash&&c.max_duration_seconds===review.maxTotalSeconds&&Array.isArray(c.required_tool_ids)&&c.required_tool_ids.length===review.toolIds.length&&review.toolIds.every(id=>c.required_tool_ids.includes(id))&&inspection.providerChecksPass;
  }),
  run('calling','Calling connection','Configured demo calling lines passed provider checks.','A demo calling line is unavailable or its routing needs attention.',async()=>{
   if(env.CONTIGUITY_FROM!==primaryBusinessPhone||!env.TWILIO_AUTH_TOKEN||!/^AC[a-fA-F0-9]{32}$/.test(env.TWILIO_ACCOUNT_SID??'')||!env.ELEVENLABS_API_KEY)return false;
   const [numbers,configs]=await Promise.all([lines,voice]);if(!numbers.length||configs.length!==1)return false;
   const [carrier,results]=await Promise.all([
    json('https://api.twilio.com/2010-04-01/Accounts/'+env.TWILIO_ACCOUNT_SID+'.json',{Authorization:'Basic '+Buffer.from(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN).toString('base64')}),
    Promise.all(numbers.map(async number=>{
    if(isAdditionalBusinessPhone(number))return secondaryCallingReady(db,env,readOnlyFetch,number);
    if(!/^phnum_[A-Za-z0-9]+$/.test(configs[0].phone_number_id))return false;
    const p=await json('https://api.elevenlabs.io/v1/convai/phone-numbers/'+configs[0].phone_number_id,{'xi-api-key':env.ELEVENLABS_API_KEY!});
    return p.phone_number===primaryBusinessPhone;
   })),
   ]);return carrier.sid===env.TWILIO_ACCOUNT_SID&&carrier.status==='active'&&results.every(Boolean);
  }),
  run('text','Text setup','Demo text lines, messaging rates, and AI reply configuration are available.','Text lines, messaging rates, or AI reply configuration need attention.',async()=>{
   if(env.ICASH_LIVE_WORK_READY!=='true'||!env.CONTIGUITY_API_KEY||!env.CONTIGUITY_WEBHOOK_SECRET||!env.OPENAI_API_KEY)return false;
   const [numbers,leases,rates,settings]=await Promise.all([
    lines,json('https://api.contiguity.com/numbers/leased',{Authorization:'Token '+env.CONTIGUITY_API_KEY}),
    db<{id:string}[]>('icash_operation_rates?operation=eq.sms_send&enabled=eq.true&select=id&limit=21'),
    db<{enabled:boolean;model:string;rate:Rate}[]>('icash_text_ai_settings?id=eq.1&select=enabled,model,rate:icash_operation_rates(enabled,operation,expires_at)&limit=2'),
   ]);
   const raw=object(leases.data).numbers;if(!Array.isArray(raw)||!numbers.length||rates.length>20||settings.length!==1||!settings[0].enabled||!settings[0].model||!current(settings[0].rate,'sms_ai'))return false;
   if(!numbers.every(number=>raw.some(item=>{const r=object(item);return object(r.number).e164===number&&r.lease_status==='active'&&Array.isArray(object(r.capabilities).channels)&&(object(r.capabilities).channels as unknown[]).includes('sms');})))return false;
   const valid=await Promise.all(rates.map(r=>db<boolean>('rpc/icash_sms_intake_rate_current','POST',{p_rate:r.id})));return valid.some(v=>v===true);
  }),
  run('contract','Contract setup','The standard one-seller purchase form and signing connection are available.','The standard purchase form, signing connection, or signing rate needs attention.',async()=>{
   if(env.DOCUSEAL_MODE!=='live'||!env.DOCUSEAL_API_KEY||env.ICASH_LIVE_WORK_READY!=='true')return false;
   const templates=await db<{provider_template_id:string;placeholder_names:string[];field_map:Record<string,string>;reviewed_until:string;rate:Rate}[]>('icash_signing_templates?template_scope=eq.standard&kind=eq.purchase&signer_count=eq.1&test_mode=eq.false&provider=eq.docuseal&enabled=eq.true&select=provider_template_id,placeholder_names,field_map,reviewed_until,rate:icash_operation_rates(enabled,operation,expires_at)&limit=2');
   if(templates.length!==1)return false;const t=templates[0];if(!/^[1-9]\d{0,14}$/.test(t.provider_template_id)||!(Date.parse(t.reviewed_until)>now())||!current(t.rate,'contract_signing')||!Array.isArray(t.placeholder_names)||t.placeholder_names.length!==2||!t.field_map||!Object.keys(t.field_map).length)return false;
   const p=await json('https://api.docuseal.com/templates/'+t.provider_template_id,{'X-Auth-Token':env.DOCUSEAL_API_KEY});
   return String(p.id)===t.provider_template_id&&p.archived_at==null&&Array.isArray(p.submitters)&&t.placeholder_names.every(name=>(p.submitters as unknown[]).some(s=>object(s).name===name))&&Array.isArray(p.fields)&&Object.values(t.field_map).every(name=>(p.fields as unknown[]).some(f=>object(f).name===name));
  }),
 ]);
 return {checkedAt:new Date(start).toISOString(),elapsedMs:Math.max(0,now()-start),setupChecksPass:checks.every(c=>c.status==='passed'),mode:'read_only',callsPlaced:0,messagesSent:0,liveCallVerified:false,checks};
}
