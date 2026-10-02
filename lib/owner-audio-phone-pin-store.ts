import {db} from '@/lib/stripe-test';
const path='icash_owner_audio_phone_pin?id=eq.1&select=review_token&limit=1';
export async function savedAudioPhonePinReview(){
 const rows=await db<{review_token:string}[]>(path);
 return rows[0]?.review_token??null;
}
/** Persist before provider mutation. A racing different review cannot replace it. */
export async function saveAudioPhonePinReview(token:string){
 const saved=await savedAudioPhonePinReview();
 if(saved)throw Error('PHONE_PIN_ALREADY_ATTEMPTED');
 try{await db('icash_owner_audio_phone_pin','POST',{id:1,review_token:token});}
 catch{throw Error('PHONE_PIN_REVIEW_SAVE_UNCONFIRMED');}
 if(await savedAudioPhonePinReview()!==token)throw Error('PHONE_PIN_REVIEW_SAVE_UNCONFIRMED');
}
