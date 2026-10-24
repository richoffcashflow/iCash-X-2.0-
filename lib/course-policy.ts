import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {CourseProgress} from './course-progress';

export const courseBucket='icash-course';
const uploadFields=z.object({kind:z.enum(['video','pdf']),type:z.enum(['video/mp4','video/webm','application/pdf']),size:z.number().int().positive().max(2147483648),name:z.string().trim().min(1).max(200),revision:z.number().int().nonnegative()}).strict();
export const courseUploadInput=uploadFields.superRefine((v,ctx)=>{
 if((v.kind==='pdf'&&(v.type!=='application/pdf'||v.size>50*1024*1024))||(v.kind==='video'&&!v.type.startsWith('video/')))ctx.addIssue({code:'custom',message:'Choose an MP4/WebM video up to 2 GB or a PDF up to 50 MB.'});
});
export type CourseKind='video'|'pdf';
export type CourseAsset={kind:CourseKind;path:string|null;name:string|null;size:number|null;mime_type:string|null;revision:number};
export type CourseOverview={owner:boolean;canUpload:boolean;vip:boolean;progress?:CourseProgress|null;assets:Record<CourseKind,{ready:boolean;name:string|null;revision:number}>};
const ticketInput=uploadFields.extend({owner:z.guid(),path:z.string().regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(mp4|webm|pdf)$/),expires:z.number().int()});
type Ticket=z.infer<typeof ticketInput>;
function signature(body:string,key:string){if(key.length<32)throw Error('Course signing unavailable');return createHmac('sha256',key).update('icash-course-upload-v1:'+body).digest('base64url');}
export function issueCourseTicket(ticket:Ticket,key:string){const body=Buffer.from(JSON.stringify(ticketInput.parse(ticket))).toString('base64url');return body+'.'+signature(body,key);}
export function readCourseTicket(token:string,owner:string,key:string,now=Date.now()):Ticket{
 const parts=token.split('.');if(token.length>3000||parts.length!==2||!/^[A-Za-z0-9_-]+$/.test(parts[0])||!/^[A-Za-z0-9_-]{43}$/.test(parts[1])||!timingSafeEqual(Buffer.from(parts[1]),Buffer.from(signature(parts[0],key))))throw Error('INVALID_COURSE_UPLOAD');
 const ticket=ticketInput.parse(JSON.parse(Buffer.from(parts[0],'base64url').toString()));
 if(ticket.owner!==owner||!ticket.path.startsWith(owner+'/')||ticket.expires<=Math.floor(now/1000)||ticket.expires>Math.floor(now/1000)+7200)throw Error('INVALID_COURSE_UPLOAD');
 return ticket;
}
