import {createHash} from 'node:crypto';
import {db} from '@/lib/stripe-test';
export const voiceHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export async function voiceTestAccess(req:Request){
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'')??'';
 if(!/^[a-f0-9]{64}$/.test(token))throw new Error('VOICE_TEST_ACCESS_DENIED');
 const hash=createHash('sha256').update(token).digest('hex');
 const [a]=await db<{expires_at:string;revoked:boolean}[]>(`icash_voice_test_access?token_hash=eq.${hash}&select=expires_at,revoked`);
 if(!a||a.revoked||Date.parse(a.expires_at)<=Date.now())throw new Error('VOICE_TEST_ACCESS_DENIED');
 return hash;
}
export type VoiceTestSession={id:string;agent_id:string;conversation_id:string|null;state:string;result:unknown;created_at:string;property_context:import('./property-context').PropertyContext|null};
