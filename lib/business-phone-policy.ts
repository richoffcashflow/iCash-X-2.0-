export const primaryBusinessPhone='+14243948384';
export const secondaryBusinessPhone='+14244377030';
export const newBusinessPhone='+17208134296';
// Calling support does not authorize these leases to send texts.
export const voiceOnlyBusinessPhones=['+14154208230','+16195364770'] as const;
export const additionalBusinessPhones=[newBusinessPhone,secondaryBusinessPhone,...voiceOnlyBusinessPhones] as const;
export const businessVoiceIngress='+17816093521';
export function isAdditionalBusinessPhone(value:unknown):value is typeof additionalBusinessPhones[number]{
 return typeof value==='string'&&additionalBusinessPhones.some(phone=>phone===value);
}
