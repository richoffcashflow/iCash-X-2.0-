import {courseAccess,courseAssets,courseAssetUrl,courseError,courseHeaders,CourseError} from '@/lib/course-server';
export async function GET(_req:Request,{params}:{params:Promise<{kind:string}>}){try{
 await courseAccess();const {kind}=await params;if(!['video','pdf'].includes(kind))throw new CourseError(404,'Course file not found.');
 const asset=(await courseAssets()).find(a=>a.kind===kind);if(!asset)throw new CourseError(404,'Course file not found.');
 return new Response(null,{status:307,headers:{...courseHeaders,Location:await courseAssetUrl(asset)}});
 }catch(e){return courseError(e);}}
