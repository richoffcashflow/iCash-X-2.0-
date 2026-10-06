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
export function chooseAccountVoice(accountId:string,voices:ProviderVoice[]){
 if(!accountId)throw Error('Account required');
 const pool=voices.filter(v=>v.category==='premade'&&/^(Chris|Eric|Sarah|Jessica|Brian)(\s|$)/.test(v.name)&&/^[a-zA-Z0-9_-]+$/.test(v.voice_id)).sort((a,b)=>a.voice_id.localeCompare(b.voice_id));
 if(!pool.length)throw Error('Voice setup is temporarily unavailable.');
 let hash=2166136261;for(const char of accountId)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
 return pool[hash%pool.length];
}
