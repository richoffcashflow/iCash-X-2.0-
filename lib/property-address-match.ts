/** Conservative comparison: mismatches remain reviewable, never overwrite the target. */
export function samePropertyAddress(a:string,b:string){
 const normalize=(v:string)=>v.toLowerCase().replace(/\bstreet\b/g,'st').replace(/\btexas\b/g,'tx').replace(/[^a-z0-9]/g,'');
 return normalize(a)===normalize(b);
}
