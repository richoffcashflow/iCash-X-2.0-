/** This installation's public identity. Each company deploys with its own configuration. */
const brandName=process.env.NEXT_PUBLIC_WEBINAR_BRAND||'iCash X';
export const webinarSite={
 companyKey:process.env.NEXT_PUBLIC_WEBINAR_COMPANY||'icash-x',
 brandName,hostName:process.env.NEXT_PUBLIC_WEBINAR_HOST||'CashFlowKey',
 assistantName:process.env.NEXT_PUBLIC_WEBINAR_ASSISTANT||`${brandName} assistant`,
 viewerPath:'/webinar',adminPath:'/webinaradmin',workspacePath:'/',checkoutPath:'/join',supportPath:'/support',
};
