import {sellerResponseDisposition} from './seller-response-policy.ts';

/** Informational intent only. No ownership, acceptance, price or call authority.
 * Keep the SQL classifier and its parity tests aligned. */
export const sellerConversionPatterns={
 identity:"(?:^|[.!?;,] +|\\band +)(?:who (?:is this|are you)|who's this|what (?:is your name|company is this|business is this)|do you have a name)(?: exactly)?(?:[?!.,;]| +and\\b| *$)",
 price:"(?:^|[.!?;,] +|\\band +)(?:what amount do you have in mind|what (?:price|amount) (?:are you offering|would you offer)|depends on (?:the|your) (?:offer|price)|(?:it )?depends (?:on )?(?:the|your) (?:offer|price))(?:[?!.,; ]|$)",
 buying:"^(?:are you (?:looking to (?:buy|purchase)|(?:buying|purchasing)(?: (?:it|the (?:house|property)))?)|(?:buying|purchasing))[?! .]*$",
 listedTerms:"^(?:the )?(?:price|terms)(?: are)? as (?:listed|advertised)[.! ]*$",
};
export type SellerConversionIntent='identity'|'identity_price'|'price'|'buying'|'listed_terms';
export function sellerConversionIntent(source:string):SellerConversionIntent|null{
 const body=source.toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
 if(!body||body.length>500||sellerResponseDisposition(body)!==null
  ||/["“”]/.test(body)||/\b(?:said|asked|wrote|example|ignore|instructions?|prompt|wire|bank account)\b/.test(body))return null;
 const identity=new RegExp(sellerConversionPatterns.identity).test(body);
 const price=new RegExp(sellerConversionPatterns.price).test(body)
  ||identity&&/\b(?:how much|what.*offer|what.*pay)\b/.test(body);
 if(identity)return price?'identity_price':'identity';
 if(price)return 'price';
 if(new RegExp(sellerConversionPatterns.buying).test(body))return 'buying';
 if(new RegExp(sellerConversionPatterns.listedTerms).test(body))return 'listed_terms';
 return null;
}
