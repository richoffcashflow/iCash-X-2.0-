/** Exact USD charge normalization. Twilio decimal strings can include redundant
 * trailing zeros; those do not make a price unknown. Never round sub-micro USD,
 * infer a null price, convert currency, or treat a positive credit as a charge. */
export function twilioUsdChargeMicros(price:unknown,unit:unknown):number|null{
 if(unit!=='USD'&&unit!=='usd'||typeof price!=='string'||price.length>80)return null;
 const match=/^(-?)(\d{1,10})(?:\.(\d+))?$/.exec(price);if(!match)return null;
 const fraction=(match[3]??'').replace(/0+$/,'');if(fraction.length>6)return null;
 const amount=BigInt(match[2])*BigInt(1000000)+BigInt(fraction.padEnd(6,'0')||'0');
 if(amount>BigInt(Number.MAX_SAFE_INTEGER)||match[1]!== '-'&&amount!==BigInt(0))return null;
 return Number(amount);
}

/** Call status, not a missing price, establishes an unanswered call. Use only
 * after canonical identity checks and after excluding any recording/AI attempt.
 * https://help.twilio.com/hc/en-us/articles/223132547
 * Twilio documents no connectivity charge for these four terminal statuses. */
export function twilioUnansweredCall(call:Record<string,unknown>):boolean{
 return ['busy','failed','no-answer','canceled'].includes(String(call.status))
  && [null,'','0'].includes(call.duration as null|string)
  && (call.price===null||twilioUsdChargeMicros(call.price,call.price_unit)===0)
  && [null,'USD','usd'].includes(call.price_unit as null|string);
}
