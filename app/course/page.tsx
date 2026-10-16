import type {Metadata} from 'next';
import {CoursePortal} from './course-portal';
export const metadata:Metadata={title:'Your iCash X course',robots:{index:false,follow:false}};
export default function Page(){return <CoursePortal/>;}
