import type {Metadata} from 'next';
import {DisputesView} from './view';
export const metadata:Metadata={title:'Disputes | iCash X',robots:{index:false,follow:false}};
export default function DisputesPage(){return <DisputesView/>;}
