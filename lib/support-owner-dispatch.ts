import {after} from 'next/server';
import {db} from './stripe-test';
import {processSupportOwnerNotifications,supportOwnerNotificationsEnabled} from './support-owner-notifications';

/** Persist first, then send without delaying the customer's response. Maintenance recovers interruptions. */
export function scheduleSupportOwnerNotifications(){
 if(!supportOwnerNotificationsEnabled())return;
 after(async()=>{try{await processSupportOwnerNotifications({db,limit:1});}catch{console.error('Support owner notification deferred to maintenance');}});
}
