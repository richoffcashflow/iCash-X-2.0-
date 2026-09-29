import {costCategories} from './cost-guard.ts';
export type CostComponents=Record<typeof costCategories[number],{amountMicros:number;evidenceRef:string}>;
export function validateCostManifest(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==costCategories.length)throw new Error('Complete cost breakdown required');
 const parts=value as CostComponents;let total=BigInt(0);
 for(const category of costCategories){const part=parts[category];if(!part||!Number.isSafeInteger(part.amountMicros)||part.amountMicros<0||typeof part.evidenceRef!=='string'||part.evidenceRef.trim().length<10)throw new Error(`Verified cost required: ${category}`);total+=BigInt(part.amountMicros);}
 if(total>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Cost total out of range');
 return {components:parts,totalMicros:Number(total)};
}
