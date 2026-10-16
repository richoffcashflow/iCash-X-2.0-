import {ZodError} from 'zod';
import {currentUser} from '@/lib/account-auth';
import {requireDashboardPassword} from '@/lib/dashboard-password';
import {ownerInboundTarget} from '@/lib/owner-inbound-acceptance';
import {workAccount} from '@/lib/work-account';
import {db} from '@/lib/stripe-test';
import {courseBucket,type CourseAsset} from '@/lib/course-policy';

export const courseHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export class CourseError extends Error{constructor(public status:number,message:string){super(message);}}
export async function courseAccess(){return workAccount({allowUnacknowledged:true});}
export async function courseOwner(){const user=await currentUser(true);if(!user)throw Error('SIGN_IN_REQUIRED');if(user.id!==ownerInboundTarget.ownerUserId)throw new CourseError(403,'Only the platform owner can change the course.');await requireDashboardPassword(user.id);return user;}
export async function courseAssets(){return db<CourseAsset[]>('icash_course_assets?select=kind,path,name,size,mime_type,revision&order=kind');}
export function courseStorage(){const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!base||!key)throw Error('Course storage unavailable');return {base,key,headers:{apikey:key,Authorization:`Bearer ${key}`}};}
export async function courseAssetUrl(asset:CourseAsset){
 if(!asset.path)throw new CourseError(404,'This course file has not been uploaded yet.');
 const {base,headers}=courseStorage();
 const res=await fetch(`${base}/storage/v1/object/sign/${courseBucket}/${asset.path}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:7200}),cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error('Course file unavailable');const data=await res.json();
 if(typeof data.signedURL!=='string'||!data.signedURL.startsWith(`/object/sign/${courseBucket}/`))throw Error('Invalid file destination');
 // Storage returns a path relative to /storage/v1, beginning with /object/sign.
 const url=new URL(`${base}/storage/v1${data.signedURL}`);if(url.origin!==new URL(base).origin||url.pathname!==`/storage/v1/object/sign/${courseBucket}/${asset.path}`||!url.searchParams.has('token'))throw Error('Invalid file destination');
 if(asset.kind==='pdf')url.searchParams.set('download','iCash-X-Course-Guide.pdf');
 return url.href;
}
export function courseError(e:unknown){
 const code=e instanceof Error?e.message:'';
 const known:Record<string,[number,string]>={SIGN_IN_REQUIRED:[401,'Sign in to watch your course.'],ACCOUNT_REQUIRED:[403,'Open your workspace to finish setting up your account.'],SUBSCRIPTION_REQUIRED:[403,'An active iCash X membership is required.'],DASHBOARD_PASSWORD_REQUIRED:[403,'Unlock owner tools to upload course files.'],INVALID_COURSE_UPLOAD:[400,'This upload expired or is invalid. Choose the file again.']};
 const [status,error]=e instanceof CourseError?[e.status,e.message]:e instanceof ZodError?[400,'Choose an MP4/WebM video up to 2 GB or a PDF up to 50 MB.']:known[code]??[503,'The course could not load. Please try again.'];
 return Response.json({error,code:known[code]?code:undefined},{status,headers:courseHeaders});
}
