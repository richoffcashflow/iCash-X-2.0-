import {House} from 'lucide-react';
import {botInitials,setupThemes,type BotProfile} from '@/lib/bot-setup';
export function BotMark({profile}:{profile:Partial<BotProfile>}){
 const theme=setupThemes[profile.theme??'ink'];
 return <span className={`setup-mark mark-${profile.logo??'monogram'}`} style={{background:theme.color,color:'#fff'}} aria-hidden="true">{profile.logo==='roof'?<House size={25} strokeWidth={1.7}/>:botInitials(profile.displayName??'')}</span>;
}
export function BotBrand({profile,compact=false}:{profile:Partial<BotProfile>;compact?:boolean}){
 return <div className={`setup-brand ${compact?'is-compact':''}`}><BotMark profile={profile}/><div><strong>{profile.displayName||'Your name here'}</strong><span>{compact?'Powered by iCash X':'Your AI real estate bot'}</span></div></div>;
}
