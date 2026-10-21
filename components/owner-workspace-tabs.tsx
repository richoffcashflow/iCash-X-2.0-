'use client';
import {LayoutDashboard,UsersRound} from 'lucide-react';
import styles from './owner-workspace-tabs.module.css';
export function OwnerWorkspaceTabs({active,onNavigate}:{active:'workspace'|'accounts';onNavigate?:(url:string)=>void}){
 return <nav className={styles.tabs} aria-label="Workspace navigation">{[{key:'workspace',url:'/',label:'My workspace',Icon:LayoutDashboard},{key:'accounts',url:'/admin/accounts',label:'Accounts',Icon:UsersRound}].map(({key,url,label,Icon})=><a key={key} href={url} aria-current={active===key?'page':undefined} onClick={onNavigate?e=>{e.preventDefault();onNavigate(url);}:undefined}><Icon size={17} aria-hidden="true"/>{label}</a>)}</nav>;
}
