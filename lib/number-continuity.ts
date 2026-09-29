// Provider numbers must already be valid E.164. Never infer a country code.
export function sameBusinessNumber(expected:string|undefined,actual:string|undefined){
 return !!expected&&/^\+[1-9]\d{7,14}$/.test(expected)&&expected===actual;
}
export function consistentTextSenders(expected:string|undefined,threads:{sender:string}[]){
 return sameBusinessNumber(expected,expected)&&threads.every(t=>sameBusinessNumber(expected,t.sender));
}
