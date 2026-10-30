'use client';
import {createContext,useContext,type ReactNode} from 'react';
import {privatePhoneDisplay} from '@/lib/private-phone-display';

const PrivatePhoneContext=createContext<string|null>(null);

// Only the authenticated owner's own workspace supplies this server-bound value.
export function OwnerPhonePrivacy({phone,children}:{phone?:string|null;children:ReactNode}){
 return <PrivatePhoneContext.Provider value={phone??null}>{children}</PrivatePhoneContext.Provider>;
}

export function PrivatePhone({children}:{children:string}){
 return <>{privatePhoneDisplay(children,useContext(PrivatePhoneContext))}</>;
}
