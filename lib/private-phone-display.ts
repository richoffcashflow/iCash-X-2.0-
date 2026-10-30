function usPhone(value:string){
 if(!/^\+?[\d\s().-]+$/.test(value))return null;
 const digits=value.replace(/\D/g,'');
 return digits.length===10?digits:digits.length===11&&digits.startsWith('1')?digits.slice(1):null;
}

/** Presentation only: callers retain the original number for every operation. */
export function privatePhoneDisplay(value:string,privatePhone?:string|null){
 const target=privatePhone?usPhone(privatePhone):null;
 return target&&usPhone(value)===target?target.slice(0,5)+'****':value;
}
