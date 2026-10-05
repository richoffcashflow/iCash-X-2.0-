/** A US phone input may contain ordinary spaces, parentheses or dashes. */
export function normalizeSigningPhone(raw:string){
 if(!/^[+\d\s().-]+$/.test(raw))return null;
 const digits=raw.replace(/\D/g,'');
 const value=digits.length===10?'+1'+digits:digits.length===11&&digits.startsWith('1')?'+'+digits:'';
 return /^\+1[2-9]\d{9}$/.test(value)?value:null;
}
