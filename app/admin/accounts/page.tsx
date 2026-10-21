import type {Metadata} from 'next';
import {AccountDirectory} from './directory';
export const metadata:Metadata={title:'Accounts | iCash X Admin',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function AccountsPage(){return <AccountDirectory/>;}
