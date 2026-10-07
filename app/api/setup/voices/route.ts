import {NextResponse} from 'next/server';
import {setupVoices} from '@/lib/setup-voices';
export async function GET(){try{return NextResponse.json({voices:await setupVoices()},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({voices:[],error:'Voice previews are temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});}}
