import type {ReactNode} from 'react';
import {FileCheck2,FileClock} from 'lucide-react';
import type {agreementWorkspace} from '@/lib/agreement-workspace';

export function AgreementStatus({status,children}:{status:ReturnType<typeof agreementWorkspace>;children?:ReactNode}){
 const Icon=status.purchaseSigned?FileCheck2:FileClock;
 return <section className="agreement-status" aria-label="Agreement status"><Icon size={20} aria-hidden="true"/><div><strong>{status.title}</strong><p>{status.detail}</p>{children}</div></section>;
}
