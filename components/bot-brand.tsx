import {House} from 'lucide-react';
import {setupThemes,type BotProfile} from '@/lib/bot-setup';
export function BotMark({profile}:{profile:Partial<BotProfile>}){
 const theme=setupThemes[profile.theme??'ink'];
 return <span className="setup-mark" style={{background:theme.color,color:'#fff'}} aria-hidden="true"><House size={25} strokeWidth={1.7}/></span>;
}
export function BotBrand({profile,compact=false}:{profile:Partial<BotProfile>;compact?:boolean}){
 return <div className={`setup-brand ${compact?'is-compact':''}`}><BotMark profile={profile}/><div><strong>{profile.displayName||'Your AI bot'}</strong><span>{'Your AI real estate bot'}</span></div></div>;
}
