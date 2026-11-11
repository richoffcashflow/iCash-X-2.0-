export const primaryBusinessPhone='+14243948384';
export const secondaryBusinessPhone='+14244377030';
export const newBusinessPhone='+17208134296';
// Calling support does not authorize these leases to send texts.
export const voiceOnlyBusinessPhones=['+14154208230','+16195364770'] as const;
// November leases still require current provider verification before activation.
export const novemberBusinessPhones=['+16462959838','+18623812530','+17866727869','+16462494809',
 '+15056019451','+15055072937','+15127791343','+16027722055','+14357242174'] as const;
export const additionalBusinessPhones=[newBusinessPhone,secondaryBusinessPhone,...voiceOnlyBusinessPhones,...novemberBusinessPhones] as const;
export const businessVoiceIngress='+17816093521';
export function isAdditionalBusinessPhone(value:unknown):value is typeof additionalBusinessPhones[number]{
 return typeof value==='string'&&additionalBusinessPhones.some(phone=>phone===value);
}
