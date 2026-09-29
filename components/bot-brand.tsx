import {House} from 'lucide-react';
import {botInitials,setupThemes,type BotProfile} from '@/lib/bot-setup';
export function BotMark({profile}:{profile:Partial<BotProfile>}){
 const theme=setupThemes[profile.theme??'ink'];
 return <span className={`setup-mark mark-${profile.logo??'monogram'}`} style={{background:theme.color,color:'#fff'}} aria-hidden="true">{profile.aiLogo!=null?<img src={`/api/setup/logo?choice=${profile.aiLogo}&name=${encodeURIComponent(profile.displayName??'')}&theme=${profile.theme}`} alt="" width={36} height={36} style={{background:'#fff',borderRadius:8}}/>:profile.logo==='roof'?<House size={25} strokeWidth={1.7}/>:botInitials(profile.displayName??'')}</span>;
}
export function BotBrand({profile,compact=false}:{profile:Partial<BotProfile>;compact?:boolean}){
 return <div className={`setup-brand ${compact?'is-compact':''}`}><BotMark profile={profile}/><div><strong>{profile.displayName||'Your AI bot'}</strong><span>{'Your AI real estate bot'}</span></div></div>;
}
