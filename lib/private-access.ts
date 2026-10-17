import {createHash} from 'node:crypto';
import {cookies} from 'next/headers';
import {db} from '@/lib/stripe-test';
import {accountMode} from '@/lib/account-mode';

export const privateAccessCookie='__Host-icash_invite';
export const privateAccessHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'};
export function privateInviteHash(token:string|undefined){return token&&/^[a-f0-9]{64}$/.test(token)?createHash('sha256').update(token).digest('hex'):null;}
export async function privateInvite(token:string|undefined){
 const hash=privateInviteHash(token),mode=accountMode();
 if(!hash||!mode)return null;
 const [invite]=await db<{id:string;expires_at:string|null}[]>(`icash_private_invites?token_hash=eq.${hash}&mode=eq.${mode}&enabled=eq.true&select=id,expires_at&limit=1`);
 return invite&&(!invite.expires_at||Date.parse(invite.expires_at)>Date.now())?{hash,mode}:null;
}
export async function currentPrivateInvite(){return privateInvite((await cookies()).get(privateAccessCookie)?.value);}
