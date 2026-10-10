import type {Metadata} from 'next';
import {OwnerOverviewView} from './overview';
export const metadata:Metadata={title:'Admin | iCash X',robots:{index:false,follow:false}};
export default function AdminPage(){return <OwnerOverviewView/>;}
