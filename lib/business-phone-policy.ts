export const primaryBusinessPhone='+14243948384';
export const secondaryBusinessPhone='+14244377030';
export const newBusinessPhone='+17208134296';
export const additionalBusinessPhones=[newBusinessPhone,secondaryBusinessPhone] as const;
export const businessVoiceIngress='+17816093521';
export function isAdditionalBusinessPhone(value:unknown):value is typeof additionalBusinessPhones[number]{
 return typeof value==='string'&&additionalBusinessPhones.some(phone=>phone===value);
}
