// Paid development simulations are stopped at the owner's request.
// Re-enabling requires new explicit approval and an enforced spending limit.
// Credentials, environment flags, CI and prior test requests do not enable them.
export function assertPaidProviderSimulationsAllowed(){
 const error=new Error('Paid provider simulations are disabled. New owner approval with a spending limit is required.');
 error.code='PAID_PROVIDER_SIMULATIONS_DISABLED_BY_OWNER';
 throw error;
}

export async function testAutomaticOfferProvider(){
 assertPaidProviderSimulationsAllowed();
}
