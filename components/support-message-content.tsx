import {supportWorkspaceUrl,supportVipUpgradeUrl} from '@/lib/support-coaching';

/** Link only our two verified navigation targets in support replies, never user URLs. */
export function SupportMessageContent({content,role}:{content:string;role:string}){
 if(role!=='assistant'&&role!=='operator')return <>{content}</>;
 const parts=content.split(/(https:\/\/www\.geticashx\.com\/\?upgrade=vip|https:\/\/www\.geticashx\.com\/)/g);
 return <>{parts.map((part,index)=>(part===supportWorkspaceUrl||part===supportVipUpgradeUrl)&&!/^[\w/?#=&%-]/.test(parts[index+1]??'')?<a key={index} href={part}>{part===supportVipUpgradeUrl?'Review VIP upgrade':'Open workspace'}</a>:part)}</>;
}
