import type {Metadata} from 'next';
import {AccessHelp} from '@/components/access-help';
import {IcashMark} from '@/components/icash-mark';
import '../access.css';
import './help.css';
export const metadata:Metadata={title:'Help getting into your account | iCash X',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function AccessHelpPage(){return <main className="purchase-access-shell"><a className="purchase-access-logo" href="/access" aria-label="iCash X account access"><IcashMark/></a><div className="purchase-access-card"><AccessHelp/></div></main>;}
