export type CustomerIdentity={first_name:string;last_name:string;company_name:string;principal:string;voice_id:string;voice_name:string};
export function identityNames(input:unknown){
 if(!input||typeof input!=='object')throw Error('Enter your name.');
 const data=input as Record<string,unknown>;
 function name(key:string,required:boolean,max:number){
  const raw=data[key];
  if(raw!==undefined&&typeof raw!=='string')throw Error('Check your name.');
  const value=typeof raw==='string'?raw.trim().replace(/\s+/g,' '):'';
  if((required&&!value)||value.length>max||/[\u0000-\u001f<>\{\}]/u.test(value))throw Error('Enter a valid name.');
  return value;
 }
 const company_name=name('company_name',false,160);
 const first_name=name('first_name',!company_name,80),last_name=name('last_name',!company_name,80);
 return {first_name,last_name,company_name,principal:company_name||`${first_name} ${last_name}`};
}
type ProviderVoice={voice_id:string;name:string;category:string};
/** Deterministic initial assignment; persist result so catalog changes cannot change follow-ups. */
export function chooseAccountVoice(accountId:string,voices:ProviderVoice[],approvedVoiceIds:string[]){
 if(!accountId)throw Error('Account required');
 if(!Array.isArray(approvedVoiceIds)||!approvedVoiceIds.length)throw Error('Reviewed voice setup unavailable');
 const pool=voices.filter(v=>approvedVoiceIds.includes(v.voice_id)&&v.category==='premade'&&/^(Chris|Eric|Sarah|Jessica|Brian)(\s|$)/.test(v.name)&&/^[a-zA-Z0-9_-]+$/.test(v.voice_id)).sort((a,b)=>a.voice_id.localeCompare(b.voice_id));
 if(!pool.length)throw Error('Voice setup is temporarily unavailable.');
 let hash=2166136261;for(const char of accountId)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
 return pool[hash%pool.length];
}

/** Read current operator-reviewed eligibility; never derive voice authority from names or presets. */
export async function readReviewedAccountVoices(db:<T>(path:string)=>Promise<T>,now=Date.now()){
 const [template]=await db<{enabled:boolean;reviewed_at:string;reviewed_until:string;approved_voice_ids:unknown}[]>('icash_voice_production_template?id=eq.1&select=enabled,reviewed_at,reviewed_until,approved_voice_ids');
 if(!template?.enabled||!Number.isFinite(Date.parse(template.reviewed_at))||Date.parse(template.reviewed_at)>now||!Number.isFinite(Date.parse(template.reviewed_until))||Date.parse(template.reviewed_until)<=now||!Array.isArray(template.approved_voice_ids))return [];
 const ids=template.approved_voice_ids;if(!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id)))return [];
 return [...new Set(ids)] as string[];
}
