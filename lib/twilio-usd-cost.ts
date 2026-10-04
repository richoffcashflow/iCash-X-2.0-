/** Exact USD charge normalization. Twilio decimal strings can include redundant
 * trailing zeros; those do not make a price unknown. Never round sub-micro USD,
 * infer a null price, convert currency, or treat a positive credit as a charge. */
export function twilioUsdChargeMicros(price:unknown,unit:unknown):number|null{
 if(unit!=='USD'&&unit!=='usd'||typeof price!=='string'||price.length>80)return null;
 const match=/^(-?)(\d{1,10})(?:\.(\d+))?$/.exec(price);if(!match)return null;
 const fraction=(match[3]??'').replace(/0+$/,'');if(fraction.length>6)return null;
 const amount=BigInt(match[2])*1000000n+BigInt(fraction.padEnd(6,'0')||'0');
 if(amount>BigInt(Number.MAX_SAFE_INTEGER)||match[1]!== '-'&&amount!==0n)return null;
 return Number(amount);
}
