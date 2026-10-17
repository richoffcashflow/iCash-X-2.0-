import {after} from 'next/server';
import {db} from './stripe-test';
import {processSupportCustomerNotifications,supportCustomerNotificationsEnabled} from './support-customer-notifications';

export function scheduleSupportCustomerNotifications(){
 if(!supportCustomerNotificationsEnabled())return;
 after(async()=>{try{await processSupportCustomerNotifications({db,limit:2});}catch{console.error('Customer support notification deferred to maintenance');}});
}
