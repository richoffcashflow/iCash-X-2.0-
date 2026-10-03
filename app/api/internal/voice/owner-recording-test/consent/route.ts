import {ownerRecordingServer} from '@/lib/owner-recording-test-server';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export const POST=(request:Request)=>ownerRecordingServer().consent(request);
