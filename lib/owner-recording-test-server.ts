import {db} from '@/lib/stripe-test';
import {createOwnerRecordingProviders} from './owner-recording-test-provider.ts';
import {ownerRecordingService} from './owner-recording-test-service.ts';
export const ownerRecordingServer=()=>ownerRecordingService(process.env,{db,provider:createOwnerRecordingProviders(process.env)});
