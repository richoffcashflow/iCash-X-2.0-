const incrementCents=100_000;
function validPrice(value:number){
 if(!Number.isSafeInteger(value)||value<=0)throw Error('Positive property price required');
}
/** A new seller proposal may never exceed the calculated ceiling or seller ask. */
export function roundedSellerPrice(priceCents:number){
 validPrice(priceCents);
 return Math.floor(priceCents/incrementCents)*incrementCents;
}
/** Set a new buyer asking price before marketing or preparing the assignment. */
export function roundedBuyerPrice(priceCents:number){
 validPrice(priceCents);
 const rounded=Math.ceil(priceCents/incrementCents)*incrementCents;
 if(!Number.isSafeInteger(rounded))throw Error('Property price is too large');
 return rounded;
}
