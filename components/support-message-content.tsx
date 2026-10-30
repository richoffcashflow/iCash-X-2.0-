import {supportWorkspaceUrl,supportVipUpgradeUrl} from '@/lib/support-coaching';
import {supportLegacyOfferUrl} from '@/lib/support-legacy-migration';

const labels:Record<string,string>={[supportWorkspaceUrl]:'Open workspace',[supportVipUpgradeUrl]:'Review VIP upgrade',[supportLegacyOfferUrl]:'Review your two-month offer'};
/** Link only exact approved destinations in support replies, never user URLs. */
export function SupportMessageContent({content,role}:{content:string;role:string}){
 if(role!=='assistant'&&role!=='operator')return <>{content}</>;
 const parts=content.split(/(https?:\/\/[^\s<>"']+)/g);
 return <>{parts.map((part,index)=>{const url=part.replace(/[.,!;:)\]]+$/g,'');return Object.hasOwn(labels,url)?<span key={index}><a href={url}>{labels[url]}</a>{part.slice(url.length)}</span>:part;})}</>;
}
