export const primaryBusinessPhone='+14243948384';
export const secondaryBusinessPhone='+14244377030';
export const newBusinessPhone='+17208134296';
// These leases can connect incoming calls; outbound readiness is checked separately.
export const inboundBusinessPhones=['+14154208230','+16195364770'] as const;
export const additionalBusinessPhones=[newBusinessPhone,secondaryBusinessPhone,...inboundBusinessPhones] as const;
export const businessVoiceIngress='+17816093521';
export function isInboundOnlyBusinessPhone(value:unknown):value is typeof inboundBusinessPhones[number]{
 return typeof value==='string'&&inboundBusinessPhones.some(phone=>phone===value);
}
export function isAdditionalBusinessPhone(value:unknown):value is typeof additionalBusinessPhones[number]{
 return typeof value==='string'&&additionalBusinessPhones.some(phone=>phone===value);
}
