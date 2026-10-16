export const dashboardPages=['/admin','/webinaradmin','/webinar-studio','/messagingadmin','/owner-pricing','/seller-operations','/owner-reception','/owner-inbound-acceptance','/owner-voice-acceptance','/owner-recording-test','/support/admin','/support/buyer-reviews','/voice-test','/test-bot'];
export function dashboardPath(path:string){return dashboardPages.some(p=>path===p||path.startsWith(p+'/'));}
export function dashboardReturnPath(value:unknown){
 if(typeof value!=='string'||value.length>2000||!value.startsWith('/')||value.startsWith('//')||/[\\\r\n]/.test(value))return '/admin';
 try{
  const u=new URL(value,'https://dashboard.invalid');
  const previewId=u.searchParams.get(u.pathname==='/webinar'?'preview':'webinar');
  const preview=(u.pathname==='/webinar'||u.pathname==='/webinar/checkout/preview')&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(previewId??'');
  return u.origin==='https://dashboard.invalid'&&(dashboardPath(u.pathname)||preview||u.pathname==='/preview/workspace'||u.pathname==='/course')?u.pathname+u.search:'/admin';
 }catch{return '/admin';}
}
