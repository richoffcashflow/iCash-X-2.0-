/** Count a single SMS segment without treating ordinary punctuation as Unicode. */
const basic=new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
const extended=new Set(Array.from('\f^{}\\[~]|€'));
export function smsLength(text:string){
 let units=0;
 for(const c of text){if(basic.has(c))units++;else if(extended.has(c))units+=2;else return {units:text.length,limit:70,fits:text.length<=70};}
 return {units,limit:160,fits:units<=160};
}
